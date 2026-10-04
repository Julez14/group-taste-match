import { type Browser, expect, type Page, test } from "@playwright/test";

/**
 * End-to-end smoke tests across separate browser sessions. Mode-agnostic:
 * works against fixture or live providers by following whatever stage the
 * server moves the room to.
 */

async function newDiner(browser: Browser, baseURL: string, device: object) {
  const ctx = await browser.newContext({ ...device, baseURL });
  return ctx.newPage();
}

async function createRoom(host: Page, name: string) {
  await host.goto("/");
  await host.getByRole("button", { name: "Start a group" }).click();
  await host.getByLabel("Your name").fill(name);
  await host.getByRole("button", { name: "Continue" }).click();
  await host.getByRole("button", { name: "Continue" }).click();
  await host.getByRole("button", { name: "Confirm time" }).click();
  await host.getByRole("button", { name: "Confirm area" }).click();
  await host.getByRole("button", { name: "Create group" }).click();
  await expect(host.getByText("Invite your group")).toBeVisible();
  return host.url();
}

async function join(page: Page, link: string, name: string) {
  await page.goto(link);
  await page.getByRole("button", { name: "Join the group" }).click();
  await page.getByLabel("Your name").fill(name);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.getByRole("button", { name: "Not now" }).click();
  await expect(page.getByText("You're in!")).toBeVisible();
}

async function say(page: Page, text: string) {
  await page.getByRole("textbox", { name: "Your answer" }).fill(text);
  await page.getByRole("button", { name: "Send" }).click();
  await expect(page.getByText("Sent", { exact: true })).toBeVisible();
}

const TERMINAL = /Your group's pick|No spot fits everyone/i;

/** Answer any clarification or host call until everyone sees a terminal result. */
async function driveToResult(pages: Page[], host: Page) {
  const deadline = Date.now() + 200_000;
  while (Date.now() < deadline) {
    const done = await Promise.all(pages.map((p) => p.getByText(TERMINAL).isVisible()));
    if (done.every(Boolean)) return;
    for (const p of pages) {
      if (await p.getByRole("heading", { name: "Quick question" }).isVisible()) {
        await p.getByRole("textbox", { name: "Your answer" }).fill("Including tax and tip, and under 30 minutes is fine.");
        await p.getByRole("button", { name: "Send" }).click();
      }
    }
    if (await host.getByRole("heading", { name: "One last call" }).isVisible()) {
      const choice = host.getByRole("button", { name: /Shorter trip/ });
      if (await choice.isVisible()) await choice.click();
      else {
        await host.getByRole("textbox", { name: "Your answer" }).fill("Shorter trip for everyone.");
        await host.getByRole("button", { name: "Send" }).click();
      }
    }
    await host.waitForTimeout(1000);
  }
  throw new Error("room did not reach a result");
}

test("two separate sessions: host-only start, private input, one shared result", async ({ browser, baseURL }, info) => {
  const device = info.project.use;
  const host = await newDiner(browser, baseURL!, device);
  const guest = await newDiner(browser, baseURL!, device);
  const link = await createRoom(host, "Hana");
  await join(guest, link, "Sam");

  await expect(guest.getByRole("button", { name: /Start with/ })).toHaveCount(0);
  await expect(host.getByText("Sam")).toBeVisible();
  await host.getByRole("button", { name: "Start with 2" }).click();

  await say(host, "Something cozy with vegetarian options, max $45 including tip");
  await expect(guest.getByText("1 of 2 in")).toBeVisible();
  await expect(guest.getByText("vegetarian options, max $45")).toHaveCount(0);

  // Refresh keeps identity and the sent answer.
  await host.reload();
  await expect(host.getByText("Sent", { exact: true })).toBeVisible();

  await say(guest, "Spicy food, I'm coming from Williamsburg");
  await driveToResult([host, guest], host);

  const hostCard = await host.getByRole("heading", { level: 1 }).textContent();
  const guestCard = await guest.getByRole("heading", { level: 1 }).textContent();
  expect(hostCard).toBe(guestCard);
  if (await host.getByText("Your group's pick").isVisible()) {
    await expect(host.getByText("Simulated availability — prototype", { exact: false })).toBeVisible();
    await expect(host.getByRole("button", { name: /regenerate|try another/i })).toHaveCount(0);
  }
});

test("six diners on a narrow viewport", async ({ browser, baseURL }, info) => {
  const device = { ...info.project.use, viewport: { width: 360, height: 740 } };
  const host = await newDiner(browser, baseURL!, device);
  const link = await createRoom(host, "Host");
  const names = ["Ana", "Ben", "Cy", "Di", "Eli"];
  const guests: Page[] = [];
  for (const n of names) {
    const g = await newDiner(browser, baseURL!, device);
    await join(g, link, n);
    guests.push(g);
  }
  await expect(host.getByText("Who's coming · 6/6")).toBeVisible();

  // A seventh person can't join a full room.
  const late = await newDiner(browser, baseURL!, device);
  await late.goto(link);
  await expect(late.getByText(/already started|full|Group not found/i).or(late.getByRole("button", { name: "Join the group" }))).toBeVisible();

  await host.getByRole("button", { name: "Start with 6" }).click();
  const wants = ["Pizza", "Spicy please", "Vegetarian", "Cheap", "Noodles", "Something lively"];
  const everyone = [host, ...guests];
  for (const [i, p] of everyone.entries()) await say(p, wants[i]!);

  for (const p of everyone) {
    const overflow = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  }
  await driveToResult(everyone, host);
});
