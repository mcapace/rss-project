import asyncio,json,os
from pathlib import Path
from playwright.async_api import async_playwright
ROOT=Path(__file__).resolve().parents[1]
BASE=os.environ.get('WA_TEST_BASE_URL','http://127.0.0.1:3000')
AXE=os.environ.get('WA_AXE_PATH','/workspace/wa-tools/node_modules/axe-core/axe.min.js')
ARTIFACTS=Path(os.environ.get('WA_TEST_ARTIFACTS','/tmp/wa-browser-results'));ARTIFACTS.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('WA_CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
  context=await browser.new_context(viewport={'width':360,'height':900},reduced_motion='reduce')
  # Live third-party services are a separate deployment check, never contacted by this regression run.
  await context.route('**/*',lambda route: route.continue_() if route.request.url.startswith(BASE) else route.abort())
  page=await context.new_page(); errors=[];page.on('pageerror',lambda e:errors.append(str(e)))
  async def goto(path):
   r=await page.goto(BASE+path,wait_until='domcontentloaded');await page.wait_for_timeout(400);return r
  ratings=json.loads(Path(ROOT/'public/wa/ratings.json').read_text());slug=ratings['rows'][0][0]
  recipe=json.loads(Path(ROOT/'public/wa/cocktails.json').read_text())[0]['slug']
  story=json.loads(Path(ROOT/'public/wa/stories.json').read_text())[0]['slug']
  report={'journeys':[],'layouts':[],'axe':[],'errors':errors}
  for path,button,kind in [('/wa/'+slug,'#save','bottle'),('/wa/'+story,'#saveStory','story'),('/wa/recipes/'+recipe,'#save','recipe')]:
   response=await goto(path);assert response.status==200,(path,response.status)
   await page.locator(button).filter(has_text='Save to My Shelf').wait_for()
   await page.locator(button).click();await page.reload(wait_until='domcontentloaded');await page.locator(button).filter(has_text='Remove from My Shelf').wait_for()
   report['journeys'].append(kind+' save survives reload')
  await goto('/wa/shelf.html');assert await page.locator('#readerShelf article').count()==3
  await page.locator('#readerShelf button').first.click();assert await page.locator('#readerShelf article').count()==2
  await page.get_by_role('button',name='Undo',exact=True).click();assert await page.locator('#readerShelf article').count()==3
  report['journeys'].append('Shelf removal and undo')
  await goto('/wa/finder.html');await page.locator('#count').filter(has_text=f"{len(ratings['rows']):,} of {len(ratings['rows']):,}").wait_for()
  await page.locator('[data-pop="price"]').click();await page.locator('[data-price="60"]').click();await page.locator('[data-pop="price"]').click()
  url=page.url;await page.reload(wait_until='domcontentloaded');await page.locator('#count').wait_for();assert page.url==url
  await page.locator('[data-sort="price-asc"]').click();await page.go_back(wait_until='domcontentloaded');assert await page.locator('[data-sort="score"]').get_attribute('aria-pressed')=='true'
  await page.locator('#lead button[data-i]').click();await page.locator('.compare-open').click();assert await page.locator('dialog').is_visible()
  await page.locator('[data-remove]').click();assert 'No bottles selected' in await page.locator('dialog').inner_text()
  await page.get_by_role('button',name='Close comparison').click();report['journeys'].append('Filter refresh/history and comparison removal')
  await goto('/wa/cocktails.html');await page.locator('[data-cab="rye"]').click();await page.reload(wait_until='domcontentloaded');await page.locator('[data-cab="rye"][aria-pressed="true"]').wait_for();report['journeys'].append('Pantry survives reload')
  await goto('/wa/search.html?q=apple');await page.locator('#discoveryStatus').filter(has_text='results for').wait_for();assert await page.locator('#discoveryResults').get_by_text('Recipe',exact=True).count()>0
  await page.locator('.search-btn').click();await page.locator('#waSearchInput').fill('apple');await page.locator('#waSearchInput').press('Enter');await page.wait_for_url('**/search.html?q=apple');report['journeys'].append('Search Enter preserves unified query')
  for path in ['/wa/bottle.html#invalid-slug','/wa/cocktail.html#invalid-slug']:
   await goto(path);await page.get_by_text('not found',exact=False).first.wait_for()
  for path in ['/wa/invalid-slug','/wa/recipes/invalid-slug']:
   response=await goto(path);assert response.status==404
  report['journeys'].append('Invalid content never substitutes another item')
  await goto('/wa/tools.html');await page.locator('.search-btn').click();await page.keyboard.press('Shift+Tab');assert await page.locator('#waSearch').evaluate('(e)=>e.contains(document.activeElement)')
  await page.keyboard.press('Escape');report['journeys'].append('Search modal keyboard containment')
  # Explicit data failure and retry.
  await page.route('**/ratings.json',lambda route:route.fulfill(status=503,body='unavailable'))
  await goto('/wa/finder.html');await page.locator('#waDataError').wait_for();await page.unroute('**/ratings.json');await page.get_by_role('button',name='Retry loading').click();await page.locator('#count').filter(has_text=f"{len(ratings['rows']):,}").wait_for();report['journeys'].append('Data failure and retry')
  # Quota errors cannot claim a successful save.
  await goto('/wa/'+slug);await page.locator('#save').filter(has_text='Remove from My Shelf').wait_for()
  await page.evaluate("() => { Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')}; }")
  await page.locator('#save').click();assert 'Could not save' in await page.locator('.reader-status').inner_text();assert 'Remove' in await page.locator('#save').inner_text();report['journeys'].append('Storage failure preserves saved state')
  pages=[x.name for x in Path('/workspace/rss-project/public/wa').glob('*.html') if x.name not in ['bottle.html','story.html','cocktail.html']]+[slug,story,'recipes/'+recipe]
  for width in [320,360,768,1440,1920]:
   await page.set_viewport_size({'width':width,'height':900})
   for name in pages:
    await goto('/wa/'+name)
    dimensions=await page.evaluate('({width:innerWidth,scroll:document.documentElement.scrollWidth})')
    report['layouts'].append({'page':name,**dimensions})
   print('width completed',width,flush=True)
  for name in ['finder.html','tools.html','newsletter.html','shelf.html','search.html',slug,story,'recipes/'+recipe]:
   await goto('/wa/'+name);await page.add_script_tag(path=AXE)
   findings=await page.evaluate("async()=> (await axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21aa']}})).violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.map(n=>({html:n.html,summary:n.failureSummary}))}))")
   report['axe'].append({'page':name,'violations':findings})
  (ARTIFACTS/'report.json').write_text(json.dumps(report,indent=2));print(json.dumps({'journeys':report['journeys'],'overflow':[r for r in report['layouts'] if r['scroll']>r['width']],'axe':[(r['page'],[(v['id'],len(v['nodes'])) for v in r['violations']]) for r in report['axe']],'errors':errors},indent=2))
  await browser.close()
  assert not errors, errors
  assert not [r for r in report['layouts'] if r['scroll']>r['width']], 'Horizontal page overflow; see report.json'
  assert not [v for r in report['axe'] for v in r['violations']], 'Accessibility violations; see report.json'
asyncio.run(main())
