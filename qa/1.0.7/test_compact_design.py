from pathlib import Path
import ast, json
from playwright.sync_api import sync_playwright
ROOT=Path('/workspace/standup'); OUT=ROOT/'qa/1.0.7'
tree=ast.parse((OUT/'test_renderer.py').read_text())
INIT=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='INIT' for t in n.targets))
results=[]
with sync_playwright() as p:
  browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
  page=browser.new_page(viewport={'width':320,'height':480},device_scale_factor=2); page.add_init_script(INIT); errors=[]; page.on('pageerror',lambda e:errors.append(str(e)))
  page.goto((ROOT/'app/renderer/index.html').as_uri()); page.wait_for_timeout(150)
  def one_line(sel):
    vals=page.locator(sel).evaluate_all('''es=>es.map(e=>{let r=document.createRange();r.selectNodeContents(e);return r.getClientRects().length})'''); assert vals and all(v<=1 for v in vals),(sel,vals)
  def check(name):
    m=page.evaluate('''()=>{let s=document.querySelector('.app-shell'),f=document.querySelector('footer').getBoundingClientRect();return {scroll:s.scrollHeight,client:s.clientHeight,overflow:s.scrollWidth>s.clientWidth,footer:f.bottom}}''')
    assert not m['overflow'] and m['scroll']<=m['client']+1,(name,m)
    selectors=['#primary-action','#settings-action','#pause-action'] if name!='settings' else ['#cancel-settings','.settings-actions button[type=submit]']
    for sel in selectors:
      b=page.locator(sel).bounding_box(); assert b and 0<=b['y'] and b['y']+b['height']<=480,(name,sel,b)
    one_line('#primary-heading'); one_line('#status-detail'); one_line('footer'); results.append({'state':name,**m})
  check('sitting'); page.locator('#primary-action').click(); page.wait_for_timeout(800); check('standing')
  page.locator('#primary-action').click(); page.evaluate("window.__setState({due:true,remainingMs:0})"); page.wait_for_timeout(100); check('reminder')
  page.locator('#settings-action').click(); check('settings'); one_line('.check-row span'); one_line('.settings-note')
  page.set_viewport_size({'width':280,'height':420}); page.get_by_role('button',name='Save settings').scroll_into_view_if_needed(); assert page.get_by_role('button',name='Save settings').is_visible(); assert not page.evaluate('document.querySelector(".app-shell").scrollWidth>innerWidth')
  page.screenshot(path=str(OUT/'compact-design-1.0.7.png')); assert not errors,errors
  (OUT/'compact-design-results.json').write_text(json.dumps({'passed':True,'pageErrors':errors,'layouts':results,'shortScreen':'280x420 settings reachable'},indent=2)+'\n'); browser.close()
print('1.0.7 compact design checks passed')
