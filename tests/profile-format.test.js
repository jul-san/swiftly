// Unit tests for the bullet-points textarea helpers in profile-format.js.
// Pure Node; no DOM.
//
// Run with: node --test tests/profile-format.test.js

const test = require("node:test");
const assert = require("node:assert/strict");

const load = () => import("../Swiftly Extension/Resources/profile-format.js");

test("bullets are shown behind a bullet marker, one per line", async () => {
  const { bulletsToText } = await load();
  assert.equal(bulletsToText(["Built a thing.", "Shipped it."]), "• Built a thing.\n• Shipped it.");
  assert.equal(bulletsToText([]), "");
  assert.equal(bulletsToText(undefined), "");
});

test("a marker already in the saved text is not doubled", async () => {
  const { bulletsToText } = await load();
  assert.equal(bulletsToText(["• Built a thing."]), "• Built a thing.");
});

test("reading the textarea strips any typed or pasted marker", async () => {
  const { textToBullets } = await load();
  assert.deepEqual(
    textToBullets("• Built a thing.\n- Shipped it.\n* Fixed it.\n▪ Tested it.\no Documented it.\nNo marker."),
    ["Built a thing.", "Shipped it.", "Fixed it.", "Tested it.", "Documented it.", "No marker."],
  );
});

test("round trip keeps the saved bullets unchanged", async () => {
  const { bulletsToText, textToBullets } = await load();
  const bullets = ["Cut p99 latency by 40%.", "Owned the -v flag.", "o11y dashboards"];
  assert.deepEqual(textToBullets(bulletsToText(bullets)), bullets);
});
