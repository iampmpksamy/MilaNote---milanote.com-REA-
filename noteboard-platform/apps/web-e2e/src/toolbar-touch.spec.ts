import { expect, test } from '@playwright/test';

// On a phone, tapping a tool creates the card when the finger lifts and the toolbar switches to the
// card's own tools. The tap's leftover click must not press whatever button is now under the finger
// (it opened the Trash, or could have pressed Delete on the new card).
test.use({ viewport: { width: 412, height: 860 }, hasTouch: true, isMobile: true });

test('tapping tools on a phone creates cards and presses nothing else', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.nb-world nb-card-view').first()).toBeVisible();
  for (const name of ['Note', 'To-do', 'Comment', 'Table', 'Link']) {
    const before = await page.locator('.nb-world nb-card-view').count();
    // Back to the main tools (a card is selected after the previous one).
    await page.keyboard.press('Escape');
    await page.locator('.nb-canvas').tap({ position: { x: 10, y: 10 } });
    const tool = page.locator(`.nb-toolbar .nb-tool[data-tool="${name}"]`);
    await tool.scrollIntoViewIfNeeded();
    await tool.tap();
    await expect(page.locator('.nb-world nb-card-view'), name).toHaveCount(before + 1);
    await page.waitForTimeout(300);
    await expect(page.locator('.nb-trash'), `${name}: the Trash must not open`).toHaveCount(0);
    await expect(page.locator('.nb-world nb-card-view'), `${name}: the new card must not be deleted`).toHaveCount(before + 1);
  }
});
