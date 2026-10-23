from pathlib import Path
import json, os, re, signal, socket, subprocess, tempfile, time, urllib.request
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[2]
QA = ROOT / 'qa/1.0.7'
with socket.socket() as s:
    s.bind(('127.0.0.1', 0))
    port = s.getsockname()[1]
with tempfile.TemporaryDirectory(prefix='sitstride-runtime-107-') as profile:
    env = {**os.environ, 'XDG_CONFIG_HOME': profile, 'STANDUP_DIAGNOSTICS': str(QA/'runtime.jsonl')}
    with (QA/'runtime.log').open('w') as log:
        display_file = Path(profile)/'display'
        proc = subprocess.Popen(['xvfb-run', '-a', 'sh', '-c', 'printf "%s\n%s\n" "$DISPLAY" "$XAUTHORITY" > "$1"; shift; xfwm4 --compositor=off >/dev/null 2>&1 & sleep 0.5; exec "$@"', 'sitstride-qa', str(display_file), str(ROOT/'release/1.0.7/linux-unpacked/sitstride-desktop'), '--no-sandbox', '--disable-gpu', f'--remote-debugging-port={port}'], env=env, stdout=log, stderr=log, start_new_session=True)
        try:
            for _ in range(150):
                if proc.poll() is not None:
                    raise AssertionError(f'Electron exited early: {proc.returncode}')
                try:
                    with urllib.request.urlopen(f'http://127.0.0.1:{port}/json/version', timeout=1) as response:
                        json.load(response)
                    break
                except Exception:
                    time.sleep(.2)
            else:
                raise AssertionError('Electron debugging endpoint did not become ready')
            display, authority = display_file.read_text().splitlines()
            xenv = {**os.environ, 'DISPLAY': display, 'XAUTHORITY': authority}
            def wait_window(visible):
                for _ in range(100):
                    tree = subprocess.check_output(['xwininfo', '-display', display, '-root', '-tree'], text=True, env=xenv)
                    matches = re.findall(r'(0x[0-9a-f]+) \"SitStride[^\"]*\"', tree)
                    if matches:
                        info = subprocess.check_output(['xwininfo', '-display', display, '-id', matches[0]], text=True, env=xenv)
                        mapped = 'Map State: IsViewable' in info
                        if mapped == visible:
                            return
                    time.sleep(.05)
                raise AssertionError(f'Window map state did not become visible={visible}: {tree}')
            with sync_playwright() as p:
                browser = p.chromium.connect_over_cdp(f'http://127.0.0.1:{port}')
                page = browser.contexts[0].pages[0]
                page.wait_for_function("() => typeof window.standup?.onCloseDialog === 'function'")
                state = page.evaluate('window.standup.getState()')
                assert state['settings']['sitMinutes'] == 60 and state['settings']['standMinutes'] == 5
                assert state['mode'] == 'sitting' and not state['paused']
                page.emulate_media(reduced_motion='no-preference')
                page.locator('#settings-action').click()
                page.locator('#reduced-motion').check()
                page.get_by_role('button', name='Save settings').click()
                assert page.evaluate('window.standup.getState()')['settings']['reducedMotion'] is True
                saved = json.loads((Path(profile)/'StandUp/settings.json').read_text())
                assert saved['reducedMotion'] is True
                page.locator('#hide-button').click()
                assert page.locator('#close-dialog').is_visible()
                assert page.evaluate('document.activeElement.id') == 'keep-tray-button'
                page.wait_for_timeout(250)
                motion = page.locator('.confirm-dialog').evaluate("e => {let s=getComputedStyle(e); return [s.transform,s.transitionProperty,s.transitionDuration];}")
                assert motion == ['none','opacity','0.12s'], motion
                page.screenshot(path=str(QA/'SitStride-close-dialog-runtime-1.0.7.png'))
                before = page.evaluate('window.standup.getState()')
                page.locator('#keep-tray-button').click()
                wait_window(False)
                page.wait_for_timeout(1300)
                after = page.evaluate('window.standup.getState()')
                assert after['remainingMs'] < before['remainingMs'] - 900 and not after['paused']
                page.locator('#close-dialog').wait_for(state='hidden')
                assert proc.poll() is None
                page.evaluate("window.standup.action('request-close')")
                wait_window(True)
                assert page.locator('#close-dialog').is_visible()
                page.keyboard.press('Escape')
                page.locator('#close-dialog').wait_for(state='hidden')
                page.locator('#minimize-button').click()
                wait_window(False)
                page.locator('#close-dialog').wait_for(state='hidden')
                assert not page.evaluate('window.standup.getState()')['paused']
                page.evaluate("window.standup.action('request-close')")
                wait_window(True)
                page.keyboard.press('Escape')
                page.locator('#primary-action').click()
                standing = page.evaluate('window.standup.getState()')
                assert standing['mode'] == 'standing' and standing['totalMs'] == 300000
                assert '250 steps' in page.locator('#status-detail').inner_text()
                page.locator('#primary-action').click()
                sitting = page.evaluate('window.standup.getState()')
                assert sitting['mode'] == 'sitting' and sitting['totalMs'] == 3600000
                page.locator('#hide-button').click()
                page.locator('#quit-sitstride-button').click()
                assert proc.wait(timeout=15) == 0
                result = {'passed': True, 'platform': 'Linux Electron under Xvfb with xfwm4', 'packagedAsar': True, 'realPreloadIPC': True, 'checks': ['default 60/5 cycle', 'X opens close dialog', 'safe initial focus', 'Keep hides window', 'timer advances while hidden', 'reopen after Keep', 'Escape dismisses dialog', 'minimize silently hides with no pause', 'standing interval and 250 steps', 'return to 60-minute sitting', 'Quit exits process with code 0', 'saved app Reduce motion with OS off persists on disk and gives opacity-only dialog'], 'nativeWindowsTested': False}
                (QA/'runtime-verification.json').write_text(json.dumps(result, indent=2)+'\n')
                print(json.dumps(result, indent=2))
        finally:
            if proc.poll() is None:
                os.killpg(proc.pid, signal.SIGTERM)
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    os.killpg(proc.pid, signal.SIGKILL)
