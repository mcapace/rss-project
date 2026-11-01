"""Real pointer/keyboard regressions for the November design audit. Run against a local Next server."""
import asyncio, json, os
from pathlib import Path
from playwright.async_api import async_playwright
BASE=os.environ.get('WA_TEST_BASE_URL','http://127.0.0.1:3000')
OUT=Path(os.environ.get('WA_TEST_ARTIFACTS','/tmp/wa-design-results'));OUT.mkdir(parents=True,exist_ok=True)
async def main():
 async with async_playwright() as p:
  browser=await p.chromium.launch(executable_path=os.environ.get('WA_CHROMIUM_PATH','/usr/bin/chromium'),args=['--no-sandbox','--disable-dev-shm-usage'])
  context=await browser.new_context(viewport={'width':390,'height':844},has_touch=True,reduced_motion='reduce')
  await context.route('**/*',lambda r:r.continue_() if r.request.url.startswith(BASE) else r.abort())
  page=await context.new_page();errors=[];page.on('pageerror',lambda e:errors.append(str(e)));checks=[]
  async def go(path):
   await page.goto(BASE+'/wa/'+path,wait_until='domcontentloaded')
  for width in [390,834,1440]:
   await page.set_viewport_size({'width':width,'height':900});await go('finder.html');await page.locator('#lead h2').wait_for()
   await page.locator('[data-pop="price"]').click();await page.locator('[data-price="60"]').click();await page.locator('#filterDone').click();assert await page.locator('[data-v="price"]').inner_text()=='up to $60'
   assert await page.locator('.shelf-bottle').count()==11
   if width==390:assert (await page.locator('.shelf-bottle').first.bounding_box())['height']<280
   await page.locator('#lead button[data-i]').click();await page.locator('.shelf-bottle button[data-i]').first.click();await page.locator('.compare-open').click();assert await page.locator('#compareCards article').count()==2
   await page.locator('.comparison-sheet').evaluate('e=>e.scrollTop=e.scrollHeight');box=await page.locator('#compareClose').bounding_box();assert box and box['y']>=0 and box['y']+box['height']<=900
   cards=await page.locator('#compareCards article').evaluate_all('els=>els.map(e=>e.getBoundingClientRect().y)');assert cards[0]==cards[1]
   await page.keyboard.press('Escape');assert not await page.locator('.comparison-sheet').is_visible();await page.evaluate("localStorage.removeItem('wa.finder.v1')")
   checks.append('Filter hit targets, 12 results, comparison layout and close at '+str(width))
  await go('search.html?q=Ardbeg%2010');await page.locator('#discoveryResults h3').first.wait_for();assert 'Ardbeg 10 year old, 46%' in await page.locator('#discoveryResults h3').first.inner_text()
  await page.locator('.search-btn').click();await page.locator('#waSearchInput').fill('bourbon');await page.locator('#waSearchResults h4').filter(has_text='Bottles').wait_for();await page.keyboard.press('Escape');checks.append('Exact bottle age and category search')
  await go('cocktails.html');await page.locator('.pantry-editor summary').click();await page.locator('[data-cab="bourbon"]').click();await page.locator('[data-cab="simple syrup"]').click();assert await page.locator('.recipe-card').filter(has_text='How to Make a Whiskey Sour').count()==0
  await page.locator('[data-mode="missing"]').click();await page.locator('.recipe-card').filter(has_text='How to Make a Whiskey Sour').wait_for();checks.append('Pantry distinguishes lemon juice from ice')
  await go('recipes/poison-apple--whiskey-and-tequila-halloween-cocktails');await page.locator('[data-ingredient="0"]').check();await page.locator('[data-n="2"]').click();assert await page.locator('[data-ingredient="0"]').is_checked();await page.reload();await page.locator('[data-n="2"][aria-pressed="true"]').wait_for();checks.append('Recipe checklist and shareable servings')
  await go('Ardbeg-10-year-old-2026-Review-46');await page.locator('#save[aria-pressed]').wait_for();await page.locator('#save').click();await page.wait_for_function("JSON.parse(localStorage.getItem('wa.reader.v1')).shelf.length>0")
  await go('shelf.html');await page.locator('.shelf-card select').select_option('owned');await page.locator('.shelf-notes summary').click();await page.locator('.shelf-notes textarea').fill('Smoky test note');await page.get_by_role('button',name='Save note',exact=True).click();await page.reload();await page.locator('.shelf-notes summary').click();assert await page.locator('.shelf-notes textarea').input_value()=='Smoky test note'
  async with page.expect_download() as download:await page.locator('#shelfExport').click()
  exported=json.loads(Path(await (await download.value).path()).read_text());assert exported['shelf'][0]['status']=='owned'
  await page.locator('#shelfImport').set_input_files({'name':'shelf.json','mimeType':'application/json','buffer':json.dumps({'version':1,'shelf':[{'kind':'recipe','slug':'test-recipe','title':'Test import'},{**exported['shelf'][0],'notes':'Do not replace'}]}).encode()});await page.locator('.shelf-card').filter(has_text='Test import').wait_for();assert await page.locator('.shelf-card').count()==2;assert await page.evaluate("JSON.parse(localStorage.getItem('wa.reader.v1')).shelf[0].notes")=='Smoky test note';checks.append('Shelf collection, notes, export and non-destructive import')
  await go('producers/Yamazaki');await page.locator('#portfolioCount').filter(has_text='reviews').wait_for();assert await page.locator('#bottles .bottle').count()==12;await page.locator('#historyDetails summary').click();assert await page.locator('.history-table tbody tr').count()>12;await page.locator('#portfolioBudget').select_option('60');assert 'No reviews within' in await page.locator('#bottles').inner_text();checks.append('Producer pagination, budget and accessible history table')
  await go('woodfod-double-oaked-rye-barrell-sweet-peat-and-more-new-whiskey');await page.locator('.rp-toggle').click();await page.locator('[data-size="1"]').focus();await page.keyboard.press('ArrowRight');assert await page.locator('[data-size="1.15"]').get_attribute('aria-checked')=='true';await page.keyboard.press('Escape');await page.locator('#buyingGuides').scroll_into_view_if_needed();await page.locator('#buyingGuides .editorial-card').first.wait_for();assert await page.locator('#next .editorial-card').count()>0;assert await page.locator('.prose .signup').count()==0;checks.append('Reading keyboard settings, recommendations and buying guides')
  await page.locator('.burger').click();await page.wait_for_function("document.querySelector('main').inert");assert not await page.locator('#waChatFab').is_visible();await page.keyboard.press('Escape');await page.wait_for_function("!document.querySelector('main').inert");checks.append('Modal background and floating action isolation')
  await go('travel.html');await page.locator('.place').first.wait_for();assert await page.get_by_text('undefined',exact=True).count()==0
  await go('newsletter.html');await page.locator('[name=email]').fill('bad');await page.locator('#nlGo').click();assert await page.locator('[name=email]').get_attribute('aria-invalid')=='true';assert await page.locator('.nl-strip').count()==0;checks.append('Travel labels and newsletter validation')
  await page.set_viewport_size({'width':390,'height':844});await go('index.html');await page.locator('.rot-pause').wait_for();assert await page.locator('.rot-pause').get_attribute('aria-pressed')=='true';await page.locator('.rot-dot').first.focus();await page.keyboard.press('ArrowRight');assert await page.locator('.rot-dot').nth(1).get_attribute('aria-current')=='true';checks.append('Reduced-motion carousel and arrow keys')
  (OUT/'design-report.json').write_text(json.dumps({'checks':checks,'errors':errors},indent=2));print(json.dumps({'checks':checks,'errors':errors},indent=2));await browser.close();assert not errors,errors
asyncio.run(main())
