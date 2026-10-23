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
  window.__openSettings = () => openSettings?.();
  window.__mainClose = value => closeDialog?.(value);
  window.standup = {
    getState: async () => structuredClone(state), onState: cb => { stateCb=cb; return ()=>{}; },
    onOpenSettings: cb => { openSettings=cb; return ()=>{}; }, onCloseDialog: cb => { closeDialog=cb; return ()=>{}; },
    action: async (name,payload) => { window.__calls.push({name,payload});
      if (name==='request-close') { window.__closeEvents.push(true); closeDialog?.(true); }
      if (name==='hide' || name==='minimize') { window.__closeEvents.push(false); closeDialog?.(false); }
      if(name==='stand') Object.assign(state,{mode:'standing',due:false,paused:false,remainingMs:300000,totalMs:300000});
      if(name==='sit') Object.assign(state,{mode:'sitting',due:false,paused:false,remainingMs:3600000,totalMs:3600000});
      if(name==='pause') state.paused=true; if(name==='resume') state.paused=false;
      if(name==='snooze') Object.assign(state,{due:false,remainingMs:300000,totalMs:300000});
      if(name==='save-settings') state.settings=payload;
      stateCb?.(structuredClone(state)); return structuredClone(state);
    }
  };
})();'''


def hidden_eventually(page):
    page.wait_for_function("() => document.querySelector('#close-dialog').hidden", timeout=1200)


def styles(page, selector='#close-dialog'):
    return page.locator(selector).evaluate("e => { const s=getComputedStyle(e); return {opacity:s.opacity, transform:s.transform, transitionProperty:s.transitionProperty, animationName:s.animationName, animations:e.getAnimations().map(a=>a.animationName)}; }")


def rapid_reopen(page, reduced):
    dialog = page.locator('#close-dialog')
    page.evaluate('window.__mainClose(true)')
    page.wait_for_function("() => document.querySelector('#close-dialog').classList.contains('is-open')")
    page.wait_for_timeout(35)
    page.evaluate('window.__mainClose(false)')
    page.wait_for_timeout(45 if not reduced else 25)
    mid = styles(page)
    assert dialog.get_attribute('hidden') is None and dialog.get_attribute('aria-hidden') == 'true'
    page.evaluate('window.__mainClose(true)')
    immediate = styles(page)
    assert dialog.get_attribute('hidden') is None
    assert 'is-open' in (dialog.get_attribute('class') or '')
    assert 'is-closing' not in (dialog.get_attribute('class') or '')
    assert mid['opacity'] != immediate['opacity'] or mid['transform'] == immediate['transform'] or reduced
    page.wait_for_timeout(180 if not reduced else 120)
    assert dialog.get_attribute('hidden') is None and dialog.get_attribute('aria-hidden') is None
    assert page.evaluate('document.activeElement.id') == 'keep-tray-button'
    page.evaluate('window.__mainClose(false)')
    hidden_eventually(page)


def run():
    errors, checks = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for reduced in (False, True):
            context = browser.new_context(viewport={'width':320,'height':480}, device_scale_factor=2,
                                          reduced_motion='reduce' if reduced else 'no-preference')
            page = context.new_page(); page.add_init_script(INIT); page.on('pageerror', lambda e: errors.append(str(e)))
            page.goto((ROOT/'app/renderer/index.html').as_uri()); page.wait_for_timeout(100)
            assert page.locator('#countdown').inner_text() in ('60:00','1:00:00')
            page.locator('#hide-button').focus()
            page.evaluate('window.__mainClose(true)')
            dialog = page.locator('#close-dialog')
            assert dialog.get_attribute('hidden') is None and 'is-open' in (dialog.get_attribute('class') or '')
            # Close restores focus/background immediately, but hidden is delayed until CSS settles.
            page.evaluate('window.__mainClose(false)')
            assert dialog.get_attribute('hidden') is None and 'is-closing' in (dialog.get_attribute('class') or '')
            assert page.evaluate('document.activeElement.id') == 'hide-button'
            assert page.evaluate("[...document.querySelector('.app-shell').children].filter(e=>e.id!=='close-dialog').every(e=>!e.inert)")
            hidden_eventually(page)
            page.evaluate('window.__mainClose(true)')
            sample = styles(page)
            assert sample['animationName'] == 'none' and all(name in (None, 'none') for name in sample['animations']), sample
            dialog_sample = styles(page, '.confirm-dialog')
            assert dialog_sample['animationName'] == 'none' and all(name in (None, 'none') for name in dialog_sample['animations']), dialog_sample
            if reduced:
                assert sample['transitionProperty'] == 'opacity', sample
                assert dialog_sample['transitionProperty'] == 'opacity', dialog_sample
            else:
                assert 'transform' in dialog_sample['transitionProperty'], dialog_sample
            rapid_reopen(page, reduced)
            checks += [f'delayed hidden and immediate focus/background restore ({"reduced" if reduced else "normal"})',
                       f'no keyframe animations; transition properties verified ({"reduced opacity-only" if reduced else "normal opacity+transform"})',
                       f'rapid close/reopen reversal and delayed-hide cancellation ({"reduced" if reduced else "normal"})']
            context.close()
        assert not errors, errors
        (OUT/'renderer-results.json').write_text(json.dumps({'passed':True,'pageErrors':errors,'checks':checks}, indent=2)+'\n')
        browser.close()


if __name__ == '__main__':
    run()
    print('1.0.7 renderer regression checks passed')
