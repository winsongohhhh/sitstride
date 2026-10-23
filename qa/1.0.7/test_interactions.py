from pathlib import Path
import json
from playwright.sync_api import sync_playwright

ROOT = Path('/workspace/standup')
OUT = ROOT / 'qa/1.0.7'
INIT = r'''(() => {
  let stateCb, openSettings, closeDialog;
  let state = {mode:'sitting',due:false,paused:false,remainingMs:3600000,totalMs:3600000,completedBreaks:0,settings:{sitMinutes:60,standMinutes:5,startAtLogin:false,reducedMotion:false,sound:true}};
  window.__calls=[]; window.__closeEvents=[];
  window.__setState = patch => { state={...state,...patch}; stateCb?.(structuredClone(state)); };
  window.__mainClose = value => closeDialog?.(value);
  window.standup = { getState: async () => structuredClone(state), onState: cb => { stateCb=cb; return ()=>{}; }, onOpenSettings: cb => { openSettings=cb; return ()=>{}; }, onCloseDialog: cb => { closeDialog=cb; return ()=>{}; }, action: async (name,payload) => { window.__calls.push({name,payload}); if(name==='request-close') closeDialog?.(true); if(name==='hide'||name==='minimize') closeDialog?.(false); if(name==='save-settings') state.settings=payload; stateCb?.(structuredClone(state)); return structuredClone(state); } };
})();'''


def eventual_hidden(page):
    page.wait_for_function("() => document.querySelector('#close-dialog').hidden", timeout=1200)


def press_snapshot(page, button):
    before = button.evaluate("e => { const s=getComputedStyle(e); return [s.transform,s.filter,s.opacity,s.backgroundColor,s.color,s.boxShadow]; }")
    button.hover(); page.mouse.down(); page.wait_for_timeout(16)
    down = button.evaluate("e => { const s=getComputedStyle(e); return [s.transform,s.filter,s.opacity,s.backgroundColor,s.color,s.boxShadow]; }")
    assert any(a != b for a,b in zip(before, down)), (before, down)
    assert page.evaluate('window.__calls.length') == 0, page.evaluate('window.__calls')
    calls_during_down = page.evaluate('window.__calls.length')
    page.mouse.up(); return before, down, calls_during_down


def run():
    errors, checks = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for reduced in (False, True):
            context = browser.new_context(viewport={'width':320,'height':480}, device_scale_factor=2, reduced_motion='reduce' if reduced else 'no-preference')
            page = context.new_page(); page.add_init_script(INIT); page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto((ROOT/'app/renderer/index.html').as_uri()); page.wait_for_timeout(100)
            page.evaluate('window.__mainClose(true)')
            for selector in ('#keep-tray-button', '#quit-sitstride-button'):
                page.evaluate('window.__calls=[]')
                _, _, calls_during_down = press_snapshot(page, page.locator(selector))
                assert calls_during_down == 0, page.evaluate('window.__calls')
                page.evaluate('window.__mainClose(false)'); eventual_hidden(page); page.evaluate('window.__mainClose(true)')
            assert 'Keep reminders running in the tray.' in page.locator('#close-dialog-copy').inner_text()
            assert 'Quit SitStride to stop reminders.' in page.locator('#close-dialog-copy').inner_text()
            dialog = page.get_by_role('dialog', name='Close SitStride?')
            assert dialog.get_attribute('aria-describedby') == 'close-dialog-copy'
            assert page.evaluate("[...document.querySelector('.app-shell').children].filter(e=>e.id!=='close-dialog').every(e=>e.inert)")
            page.locator('#keep-tray-button').focus(); page.keyboard.press('Tab'); assert page.evaluate('document.activeElement.id') == 'quit-sitstride-button'
            page.keyboard.press('Tab'); assert page.evaluate('document.activeElement.id') == 'keep-tray-button'; page.keyboard.press('Shift+Tab'); assert page.evaluate('document.activeElement.id') == 'quit-sitstride-button'
            page.keyboard.press('Escape'); eventual_hidden(page); assert page.evaluate("[...document.querySelector('.app-shell').children].filter(e=>e.id!=='close-dialog').every(e=>!e.inert)")
            checks += [f'hover-to-press feedback before release without action commit ({"reduced" if reduced else "normal"})', f'exact dialog copy and role/focus trap/inert background ({"reduced" if reduced else "normal"})']
            context.close()
        assert not errors, errors
        (OUT/'interactions-results.json').write_text(json.dumps({'passed':True,'pageErrors':errors,'checks':checks}, indent=2)+'\n')
        browser.close()


if __name__ == '__main__':
    run()
    print('1.0.7 interaction regression checks passed')
