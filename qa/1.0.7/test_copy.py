from pathlib import Path
import ast, json
from playwright.sync_api import sync_playwright
ROOT=Path('/workspace/standup'); OUT=ROOT/'qa/1.0.7'
tree=ast.parse((OUT/'test_renderer.py').read_text()); INIT=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='INIT' for t in n.targets))
def issues(page):
 return page.evaluate('''()=>{let a=[];for(let e of document.querySelectorAll('body *')){let s=getComputedStyle(e),t=(e.innerText||'').trim();if(!t||e.children.length||s.display==='none'||s.visibility==='hidden')continue;let r=document.createRange();r.selectNodeContents(e);if([...r.getClientRects()].length>1)a.push({text:t,kind:'wrapped'});if(e.scrollWidth>e.clientWidth+1)a.push({text:t,kind:'clipped'})}if(document.documentElement.scrollWidth>innerWidth)a.push({kind:'overflow'});return a}''')
with sync_playwright() as p:
 browser=p.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox']); page=browser.new_page(viewport={'width':320,'height':480}); page.add_init_script(INIT); errors=[]; page.on('pageerror',lambda e:errors.append(str(e))); page.goto((ROOT/'app/renderer/index.html').as_uri()); page.wait_for_timeout(150)
 expected=[('Stay seated','Break time is coming up.','Stand up','Pause'),('Standing break','Walk 250 steps, then stretch.','Back to sitting','Pause'),('Time to stand up','Stand up and walk 250 steps.','Stand up','Pause'),('Nice work','Break done. Sit when ready.','Back to sitting','Pause'),('Take your time','Timer paused.','Stand up','Resume')]
 page.evaluate("window.__setState({mode:'sitting',due:false,paused:false,remainingMs:3600000})")
 states=[None,{'mode':'standing','due':False,'paused':False,'remainingMs':300000},{'mode':'sitting','due':True,'paused':False,'remainingMs':0},{'mode':'standing','due':True,'paused':False,'remainingMs':0},{'mode':'sitting','due':False,'paused':True,'remainingMs':3600000}]
 for st,exp in zip(states,expected):
  if st: page.evaluate('(s)=>window.__setState(s)',st)
  assert [page.locator(x).inner_text() for x in ['#primary-heading','#status-detail','#primary-action','#pause-action']]==list(exp); assert not issues(page),issues(page)
 page.locator('#settings-action').click(); assert [page.locator(f'label[for="{x}"] span').inner_text() for x in ['start-at-login','reduced-motion','sound']]==['Run on startup','Reduce motion','Play a reminder sound']; assert page.locator('.settings-note').inner_text()=='Timing changes apply next phase.'
 page.screenshot(path=str(OUT/'copy-1.0.7.png')); assert not errors,errors; result={'passed':True,'pageErrors':errors,'states':5,'checks':['250-step standing copy','paused copy','settings labels/note','single-line/no clipping at 320x480']}; (OUT/'copy-results.json').write_text(json.dumps(result,indent=2)+'\n'); browser.close()
print('1.0.7 copy checks passed')
