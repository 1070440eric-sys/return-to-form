/*
 * 劇情檢查工具。改完 story.js 之後執行：
 *
 *   node tools/check.js
 *
 * 會檢查：選項有沒有指到不存在的場景、有沒有走不到的場景、
 * 有沒有用到沒定義的線索或狀態、有沒有沒出口的場景。
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const file = path.join(__dirname, '..', 'js', 'story.js');
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file });
const story = sandbox.window.STORY;

const problems = [];
const scenes = story.scenes;
const known = new Set([...Object.keys(story.clues), ...Object.keys(story.states)]);

if (!scenes[story.start]) problems.push(`開場場景「${story.start}」不存在`);

const checkKeys = (where, keys, table, kind) => {
  (keys || []).forEach((key) => {
    if (!(key in table)) problems.push(`${where} 用到沒定義的${kind}「${key}」`);
  });
};

for (const [id, scene] of Object.entries(scenes)) {
  if (!scene.title) problems.push(`場景 ${id} 沒有 title`);
  if (!Array.isArray(scene.text) || scene.text.length === 0) problems.push(`場景 ${id} 沒有 text`);
  checkKeys(`場景 ${id}`, scene.learn, story.clues, '成就');
  checkKeys(`場景 ${id}`, scene.set, story.states, '狀態');

  const terminal = scene.death || scene.worldEnd || scene.stub;
  const choices = scene.choices || [];
  if (!terminal && choices.length === 0) problems.push(`場景 ${id} 沒有選項，玩家會卡住`);
  if (terminal && choices.length > 0) problems.push(`場景 ${id} 是結束場景，選項不會顯示`);

  // 至少要有一個不需要任何條件的選項，否則沒有線索的玩家會卡住
  if (!terminal && choices.length > 0) {
    const alwaysOpen = choices.some((c) => !(c.needs && c.needs.length));
    if (!alwaysOpen) problems.push(`場景 ${id} 的選項全部都有條件，沒線索的玩家會卡住`);
  }

  choices.forEach((choice, i) => {
    const where = `場景 ${id} 的第 ${i + 1} 個選項`;
    if (!choice.label) problems.push(`${where} 沒有 label`);
    if (!scenes[choice.to]) problems.push(`${where} 指到不存在的場景「${choice.to}」`);
    checkKeys(where, choice.learn, story.clues, '成就');
    checkKeys(where, choice.set, story.states, '狀態');
    [...(choice.needs || []), ...(choice.hideIf || [])].forEach((key) => {
      if (!known.has(key)) problems.push(`${where} 的條件用到沒定義的「${key}」`);
    });
  });
}

// 從開場能不能走到每個場景（不管條件）
const reached = new Set();
const queue = [story.start];
while (queue.length) {
  const id = queue.pop();
  if (reached.has(id) || !scenes[id]) continue;
  reached.add(id);
  (scenes[id].choices || []).forEach((c) => queue.push(c.to));
}
Object.keys(scenes).forEach((id) => {
  if (!reached.has(id)) problems.push(`場景 ${id} 從開場走不到`);
});

// 定義了卻沒有任何地方會記下的線索
const learnable = new Set();
Object.values(scenes).forEach((scene) => {
  (scene.learn || []).forEach((k) => learnable.add(k));
  (scene.choices || []).forEach((c) => (c.learn || []).forEach((k) => learnable.add(k)));
});
Object.entries(story.clues).forEach(([key, c]) => {
  if (typeof c !== 'string' && !(c && c.name)) problems.push(`成就「${key}」沒有 name`);
});
Object.keys(story.clues).forEach((key) => {
  if (!learnable.has(key)) problems.push(`成就「${key}」沒有任何場景會解鎖它`);
});

const count = Object.keys(scenes).length;
if (problems.length) {
  console.log(`找到 ${problems.length} 個問題：`);
  problems.forEach((p) => console.log(' - ' + p));
  process.exit(1);
}
console.log(`沒有問題。共 ${count} 個場景、${Object.keys(story.clues).length} 個成就。`);
