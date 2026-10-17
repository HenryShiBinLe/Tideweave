import {levelById} from '../src/levels.mjs';
export async function selectMission(page,id){
  const level=levelById[id];
  if(await page.locator('.tw-home').count())await page.locator('[data-action="campaign"]').click();
  if(await page.locator('.tw-game').count())await page.locator('.tw-mission-head [data-action="home"]').click();
  await page.locator(`[data-chapter="${level.chapter}"]`).click();
  if(level.optional)await page.locator('[data-campaign-tab="optional"]').click();
  await page.locator(`[data-select-level="${id}"]`).click();
}
export async function uiClick(page,selector){
  const match=selector.match(/^\[data-level="([^"]+)"\]$/);
  if(match)await selectMission(page,match[1]);
  else if(selector.includes('data-chapter')&&await page.locator('.tw-home').count())await page.locator('[data-action="campaign"]').click();
  await page.locator(selector).first().click();
}
