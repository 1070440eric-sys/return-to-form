/*
 * 遊戲引擎。一般不需要改這個檔案，劇情都在 story.js。
 *
 * 進度存在瀏覽器裡（localStorage）。存不了的時候照樣能玩，只是關掉分頁就會重來。
 */
(function () {
  'use strict';

  var STORY = window.STORY;
  var SAVE_KEY = 'return-to-form-save-v1';

  /* ── 可以調的設定 ── */
  var CHAR_MS = 32;          // 打字速度：每個字幾毫秒，數字越小越快
  var SKIP_SEEN = true;      // 看過的場景再進來時，文字直接全部顯示
  var HISTORY_LIMIT = 200;   // 「返回上一步」最多記幾步

  var el = {
    title: document.getElementById('game-title'),
    subtitle: document.getElementById('game-subtitle'),
    loop: document.getElementById('loop'),
    scene: document.getElementById('scene'),
    kicker: document.getElementById('kicker'),
    sceneTitle: document.getElementById('scene-title'),
    sceneText: document.getElementById('scene-text'),
    revealBar: document.getElementById('reveal-bar'),
    skip: document.getElementById('skip'),
    learned: document.getElementById('learned'),
    choices: document.getElementById('choices'),
    openNotes: document.getElementById('open-notes'),
    closeNotes: document.getElementById('close-notes'),
    notes: document.getElementById('notes'),
    notesList: document.getElementById('notes-list'),
    notesCount: document.getElementById('notes-count'),
    reset: document.getElementById('reset'),
    back: document.getElementById('back')
  };

  // 測試用：設了 window.RTF_INSTANT 就不跑打字效果
  var instant = !!window.RTF_INSTANT;
  var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  /* ── 存檔 ── */

  function freshGame() {
    return {
      scene: STORY.start,
      states: [],     // 這一輪發生過的事，返回就清掉
      clues: [],      // 玩家記得的事，死了也留著
      loop: 1,
      history: [],    // 走過的每一步（場景和當時的狀態），返回時一步一步往回退
      seen: []        // 看完過的場景，再進來時文字直接顯示
    };
  }

  function list(value) {
    return Array.isArray(value) ? value : [];
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return freshGame();
      var saved = JSON.parse(raw);
      if (!saved || !STORY.scenes[saved.scene]) return freshGame();
      var base = freshGame();
      base.scene = saved.scene;
      base.states = list(saved.states);
      base.clues = list(saved.clues);
      base.seen = list(saved.seen);
      base.loop = typeof saved.loop === 'number' ? saved.loop : 1;
      var steps = list(saved.history);
      if (!steps.length && saved.checkpoint) steps = [saved.checkpoint]; // 舊版存檔
      base.history = steps
        .filter(function (step) { return step && STORY.scenes[step.scene]; })
        .map(function (step) {
          return { scene: step.scene, states: list(step.states) };
        });
      return base;
    } catch (e) {
      return freshGame();
    }
  }

  function save() {
    try {
      window.localStorage.setItem(SAVE_KEY, JSON.stringify(game));
    } catch (e) {
      /* 存不了就算了，遊戲照常進行 */
    }
  }

  var game = load();

  /* ── 小工具 ── */

  function fill(text) {
    return String(text).replace(/\{noble\}/g, STORY.noble);
  }

  function has(key) {
    return game.clues.indexOf(key) !== -1 || game.states.indexOf(key) !== -1;
  }

  function addAll(target, keys) {
    var added = [];
    (keys || []).forEach(function (key) {
      if (target.indexOf(key) === -1) {
        target.push(key);
        added.push(key);
      }
    });
    return added;
  }

  function visible(choice) {
    var needs = choice.needs || [];
    var hideIf = choice.hideIf || [];
    for (var i = 0; i < needs.length; i++) {
      if (!has(needs[i])) return false;
    }
    for (var j = 0; j < hideIf.length; j++) {
      if (has(hideIf[j])) return false;
    }
    return true;
  }

  /* ── 遊戲流程 ── */

  // 進入一個場景。回傳這次新記下的線索。
  function enter(id) {
    var scene = STORY.scenes[id];
    game.scene = id;
    addAll(game.states, scene.set);
    return addAll(game.clues, scene.learn);
  }

  function choose(choice) {
    game.history.push({ scene: game.scene, states: game.states.slice() });
    if (game.history.length > HISTORY_LIMIT) game.history.shift();
    addAll(game.states, choice.set);
    var fresh = addAll(game.clues, choice.learn);
    fresh = fresh.concat(enter(choice.to));
    save();
    render(fresh);
  }

  // 返回上一步：回到做出上一個選擇之前的場景，狀態還原，線索保留。
  // 沒死也能用。死亡後的返回會多算一輪。
  function stepBack(countLoop) {
    var step = game.history.pop();
    if (countLoop) game.loop += 1;
    if (step && STORY.scenes[step.scene]) {
      game.scene = step.scene;
      game.states = step.states.slice();
    } else {
      game.scene = STORY.start;
      game.states = [];
    }
    save();
    render([]);
  }

  function comeBack() {
    stepBack(true);
  }

  function goBack() {
    if (!game.history.length) return;
    stepBack(false);
  }

  // 世界結束或路線未完成：回到開場，狀態清空，線索保留。
  function startOver() {
    game.loop += 1;
    game.scene = STORY.start;
    game.states = [];
    game.history = [];
    enter(STORY.start);
    save();
    render([]);
  }

  function wipe() {
    game = freshGame();
    enter(STORY.start);
    save();
    render([]);
  }

  /* ── 一段一段顯示文字 ── */

  var reveal = { done: true };

  function stopTyping() {
    if (reveal.timer) {
      clearInterval(reveal.timer);
      reveal.timer = null;
    }
  }

  function addParagraph(text) {
    var p = document.createElement('p');
    p.textContent = text;
    el.sceneText.appendChild(p);
    return p;
  }

  function removeMore() {
    var more = el.sceneText.querySelector('.more');
    if (more) more.parentNode.removeChild(more);
  }

  function startReveal(paragraphs, quick, onDone) {
    stopTyping();
    el.sceneText.textContent = '';
    reveal = { paras: paragraphs, index: 0, typing: false, node: null, full: '', timer: null, done: false, onDone: onDone };
    if (quick || instant || !paragraphs.length) {
      paragraphs.forEach(addParagraph);
      finishReveal();
      return;
    }
    el.revealBar.hidden = false;
    showNext();
  }

  function showNext() {
    var old = el.sceneText.querySelectorAll('p');
    for (var i = 0; i < old.length; i++) old[i].classList.add('past');

    var text = reveal.paras[reveal.index];
    reveal.index += 1;
    var p = addParagraph('');
    reveal.node = p;
    reveal.full = text;
    if (p.scrollIntoView) p.scrollIntoView({ block: 'nearest' });

    if (reduceMotion) {
      p.textContent = text;
      afterParagraph();
      return;
    }
    var chars = Array.from(text);
    var shown = 0;
    reveal.typing = true;
    reveal.timer = setInterval(function () {
      shown += 1;
      p.textContent = chars.slice(0, shown).join('');
      if (shown >= chars.length) {
        stopTyping();
        afterParagraph();
      }
    }, CHAR_MS);
  }

  function afterParagraph() {
    reveal.typing = false;
    if (reveal.index >= reveal.paras.length) {
      finishReveal();
      return;
    }
    var more = document.createElement('span');
    more.className = 'more';
    more.setAttribute('aria-hidden', 'true');
    more.textContent = '▼';
    reveal.node.appendChild(more);
  }

  // 點一下：正在打字就直接顯示整段，打完了就換下一段
  function advance() {
    if (reveal.done) return;
    if (reveal.typing) {
      stopTyping();
      reveal.node.textContent = reveal.full;
      afterParagraph();
      return;
    }
    removeMore();
    showNext();
  }

  function skipAll() {
    if (reveal.done) return;
    stopTyping();
    removeMore();
    if (reveal.node) reveal.node.textContent = reveal.full;
    while (reveal.index < reveal.paras.length) {
      addParagraph(reveal.paras[reveal.index]);
      reveal.index += 1;
    }
    finishReveal();
  }

  function finishReveal() {
    stopTyping();
    removeMore();
    reveal.done = true;
    reveal.typing = false;
    var past = el.sceneText.querySelectorAll('.past');
    for (var i = 0; i < past.length; i++) past[i].classList.remove('past');
    el.revealBar.hidden = true;
    if (reveal.onDone) reveal.onDone();
  }

  /* ── 畫面 ── */

  function button(label, className, onClick) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = className;
    b.textContent = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function render(freshClues) {
    var id = game.scene;
    var scene = STORY.scenes[id];

    el.scene.classList.remove('enter', 'is-death', 'is-end');
    void el.scene.offsetWidth; // 讓進場動畫重新播放
    el.scene.classList.add('enter');

    // 死亡的標示等文字跑完才出現，不先劇透
    el.kicker.textContent = '';
    el.sceneTitle.textContent = fill(scene.title);
    el.learned.textContent = '';
    el.choices.textContent = '';
    el.choices.hidden = true;
    el.revealBar.hidden = true;

    el.loop.textContent = game.loop > 1 ? '第 ' + game.loop + ' 輪' : '';
    el.notesCount.textContent = game.clues.length ? String(game.clues.length) : '';
    var ownButton = scene.death || scene.worldEnd || scene.stub;
    el.back.hidden = !!ownButton;
    el.back.disabled = game.history.length === 0;
    disarmReset();
    window.scrollTo(0, 0);

    var quick = SKIP_SEEN && game.seen.indexOf(id) !== -1;
    var paragraphs = (scene.text || []).map(fill);
    var typed = !quick && !instant && paragraphs.length > 0;

    startReveal(paragraphs, quick, function () {
      showEnding(scene, freshClues, typed);
      addAll(game.seen, [id]);
      save();
    });
  }

  function showEnding(scene, freshClues, focusChoices) {
    if (scene.death) {
      el.scene.classList.add('is-death');
      el.kicker.textContent = '你死了';
    } else if (scene.worldEnd) {
      el.scene.classList.add('is-end');
      el.kicker.textContent = '世界結束';
    }

    (freshClues || []).forEach(function (key) {
      var li = document.createElement('li');
      li.textContent = fill(STORY.clues[key] || key);
      el.learned.appendChild(li);
    });

    if (scene.death) {
      el.choices.appendChild(button('返回', 'choice return', comeBack));
    } else if (scene.worldEnd) {
      el.choices.appendChild(button('返回', 'choice return', startOver));
    } else if (scene.stub) {
      el.choices.appendChild(button('回到開場', 'choice', startOver));
    } else {
      (scene.choices || []).filter(visible).forEach(function (choice) {
        var gated = choice.needs && choice.needs.length > 0;
        el.choices.appendChild(
          button(fill(choice.label), gated ? 'choice gated' : 'choice', function () {
            choose(choice);
          })
        );
      });
    }
    el.choices.hidden = false;

    var first = el.choices.querySelector('button');
    if (first && focusChoices) first.focus({ preventScroll: true });
  }

  function renderNotes() {
    el.notesList.textContent = '';
    if (!game.clues.length) {
      var empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '還沒有記下任何事。';
      el.notesList.appendChild(empty);
      return;
    }
    game.clues.forEach(function (key) {
      var li = document.createElement('li');
      li.textContent = fill(STORY.clues[key] || key);
      el.notesList.appendChild(li);
    });
  }

  function openNotes() {
    renderNotes();
    el.notes.hidden = false;
    el.closeNotes.focus();
  }

  function closeNotes() {
    el.notes.hidden = true;
    el.openNotes.focus();
  }

  /* 全部重來要按兩次，避免誤觸 */
  var resetArmed = false;
  function disarmReset() {
    resetArmed = false;
    el.reset.textContent = '全部重來';
    el.reset.classList.remove('armed');
  }
  function onReset() {
    if (!resetArmed) {
      resetArmed = true;
      el.reset.textContent = '線索也會清掉，再按一次確定';
      el.reset.classList.add('armed');
      return;
    }
    wipe();
  }

  el.openNotes.addEventListener('click', openNotes);
  el.closeNotes.addEventListener('click', closeNotes);
  el.notes.addEventListener('click', function (e) {
    if (e.target === el.notes) closeNotes();
  });
  el.reset.addEventListener('click', onReset);
  el.back.addEventListener('click', goBack);
  el.skip.addEventListener('click', function (e) {
    e.stopPropagation();
    skipAll();
  });

  // 點畫面任何地方（按鈕除外）都能繼續
  el.scene.addEventListener('click', function (e) {
    if (e.target.closest && e.target.closest('button')) return;
    advance();
  });

  document.addEventListener('keydown', function (e) {
    if (!el.notes.hidden) {
      if (e.key === 'Escape') closeNotes();
      return;
    }
    if (reveal.done) return;
    var onButton = document.activeElement && document.activeElement.tagName === 'BUTTON';
    if ((e.key === ' ' || e.key === 'Enter') && !onButton) {
      e.preventDefault();
      advance();
    }
  });

  /* ── 開始 ── */

  el.title.textContent = STORY.title;
  el.subtitle.textContent = STORY.subtitle;
  var opening = game.scene === STORY.start && game.loop === 1 && !game.clues.length
    ? enter(STORY.start)
    : [];
  save();
  render(opening);
})();
