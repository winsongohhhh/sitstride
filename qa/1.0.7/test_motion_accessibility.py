from pathlib import Path
import json
from playwright.sync_api import sync_playwright
from test_renderer import INIT

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent

def css(page, selector):
    return page.locator(selector).evaluate("e => {const s=getComputedStyle(e); return {transform:s.transform, filter:s.filter, property:s.transitionProperty, duration:s.transitionDuration, outline:s.outlineStyle, outlineWidth:s.outlineWidth, blur:s.backdropFilter};}")

def closed(page):
    page.wait_for_function("() => document.querySelector('#close-dialog').hidden")

def run():
    errors, checks = [], []
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        for app_reduce in (False, True):
            for os_reduce in (False, True):
                effective = app_reduce or os_reduce
                context = browser.new_context(viewport={'width':320,'height':480}, device_scale_factor=2, reduced_motion='reduce' if os_reduce else 'no-preference')
                page = context.new_page()
                page.add_init_script(INIT)
                page.on('pageerror', lambda e: errors.append(str(e)))
                page.goto((ROOT/'app/renderer/index.html').as_uri())
                page.wait_for_function("() => typeof window.__setState === 'function'")
                page.locator('#settings-action').click()
                page.locator('#reduced-motion').set_checked(app_reduce)
                page.get_by_role('button', name='Save settings').click()
                page.wait_for_function(f"() => document.documentElement.dataset.reducedMotion === '{str(effective).lower()}'")
                page.locator('#hide-button').focus()
                page.keyboard.press('Enter')
                assert page.evaluate('document.activeElement.id') == 'keep-tray-button'
                page.wait_for_timeout(250)
                card = css(page, '.confirm-dialog')
                if effective:
                    assert card['transform'] == 'none', card
                    assert card['property'] == 'opacity' and card['duration'] == '0.12s', card
                    assert css(page, '#close-dialog')['blur'] == 'none'
                else:
                    assert 'transform' in card['property'] and '0.22s' in card['duration'], card
                for sel in ('#keep-tray-button', '#quit-sitstride-button'):
                    box = page.locator(sel).bounding_box()
                    assert box['width'] >= 44 and box['height'] >= 44
                    assert box['x'] >= 0 and box['y'] >= 0 and box['x']+box['width'] <= 320 and box['y']+box['height'] <= 480
                    page.locator(sel).hover()
                    before = css(page, sel)
                    page.evaluate('window.__calls=[]')
                    page.mouse.down()
                    down = css(page, sel)
                    assert down['filter'] != before['filter'], (before, down)
                    assert down['duration'] == '0s', down
                    assert page.evaluate('window.__calls.length') == 0
                    if effective:
                        assert down['transform'] == 'none', down
                    page.mouse.up()
                    name = 'hide' if sel == '#keep-tray-button' else 'quit'
                    page.wait_for_function(f"() => window.__calls.some(c => c.name === '{name}')")
                    page.evaluate('window.__mainClose(false)')
                    closed(page)
                    page.locator('#hide-button').focus()
                    page.evaluate('window.__mainClose(true)')
                    page.wait_for_timeout(250)
                assert page.get_by_role('dialog', name='Close SitStride?').get_attribute('aria-describedby') == 'close-dialog-copy'
                assert page.evaluate("[...document.querySelector('.app-shell').children].filter(e=>e.id!=='close-dialog').every(e=>e.inert)")
                page.locator('#keep-tray-button').focus()
                page.keyboard.press('Tab')
                assert page.evaluate('document.activeElement.id') == 'quit-sitstride-button'
                focus = css(page, '#quit-sitstride-button')
                assert focus['outline'] == 'solid' and focus['outlineWidth'] == '2px', focus
                page.keyboard.press('Tab')
                assert page.evaluate('document.activeElement.id') == 'keep-tray-button'
                page.keyboard.press('Shift+Tab')
                assert page.evaluate('document.activeElement.id') == 'quit-sitstride-button'
                page.keyboard.press('Escape')
                closing = css(page, '.confirm-dialog')
                if effective:
                    assert closing['transform'] == 'none' and closing['property'] == 'opacity' and closing['duration'] == '0.1s', closing
                closed(page)
                assert page.evaluate('document.activeElement.id') == 'hide-button'
                assert page.evaluate("[...document.querySelector('.app-shell').children].filter(e=>e.id!=='close-dialog').every(e=>!e.inert)")
                page.evaluate('window.__mainClose(true)')
                page.emulate_media(reduced_motion='no-preference' if os_reduce else 'reduce')
                new_effective = app_reduce or not os_reduce
                page.wait_for_function(f"() => document.documentElement.dataset.reducedMotion === '{str(new_effective).lower()}'")
                if new_effective:
                    assert css(page, '.confirm-dialog')['transform'] == 'none'
                page.evaluate("window.__setState({settings:{sitMinutes:60,standMinutes:5,startAtLogin:false,reducedMotion:true,sound:true}})")
                assert css(page, '.confirm-dialog')['transform'] == 'none'
                page.evaluate("window.__setState({settings:{sitMinutes:60,standMinutes:5,startAtLogin:false,reducedMotion:false,sound:true}})")
                page.wait_for_function(f"() => document.documentElement.dataset.reducedMotion === '{str(not os_reduce).lower()}'")
                checks.append({'appReduceMotion':app_reduce,'osReduceMotion':os_reduce,'effectiveReduceMotion':effective,'savedForm':True,'opacityOnlyWhenReduced':True,'immediatePressBeforeCommit':True,'targets44pxInViewport':True,'keyboardFocusTrapAndRestoration':True,'liveOSAndSavedUpdates':True})
                context.close()
        browser.close()
    assert not errors, errors
    (OUT/'motion-accessibility-results.json').write_text(json.dumps({'passed':True,'pageErrors':errors,'matrix':checks,'targetScope':'44px close-dialog choices; legacy compact controls unchanged','nativeWindowsTested':False}, indent=2)+'\n')
    print('1.0.7 accessibility and app/OS motion matrix passed')

if __name__ == '__main__':
    run()
