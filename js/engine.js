/*
 * 遊戲引擎。一般不需要改這個檔案，劇情都在 story.js。
 *
 * 進度存在瀏覽器裡（localStorage）。存不了的時候照樣能玩，只是關掉分頁就會重來。
 */
(function () {
  'use strict';

  var STORY = window.STORY;
  var SAVE_KEY = 'return-to-form-save-v1';

  var el = {
    title: document.getElementById('game-title'),
    subtitle: document.getElementById('game-subtitle'),
    loop: document.getElementById('loop'),
    scene: document.getElementById('scene'),
    kicker: document.getElementById('kicker'),
    sceneTitle: document.getElementById('scene-title'),
    sceneText: document.getElementById('scene-text'),
    learned: document.getElementById('learned'),
    choices: document.getElementById('choices'),
    openNotes: document.getElementById('open-notes'),
    closeNotes: document.getElementById('close-notes'),
    notes: document.getElementById('notes'),
    notesList: document.getElementById('notes-list'),
    notesCount: document.getElementById('notes-count'),
    reset: document.getElementById('reset')
  };

  /* ── 存檔 ── */

  function freshGame() {
    return {
      scene: STORY.start,
      states: [],     // 這一輪發生過的事，返回就清掉
      clues: [],      // 玩家記得的事，死了也留著
      loop: 1,
      checkpoint: null // 做出上一個選擇之前的位置，死了回到這裡
    };
  }

  function load() {
    try {
      var raw = window.localStorage.getItem(SAVE_KEY);
      if (!raw) return freshGame();
      var saved = JSON.parse(raw);
      if (!saved || !STORY.scenes[saved.scene]) return freshGame();
      var base = freshGame();
      base.scene = saved.scene;
      base.states = Array.isArray(saved.states) ? saved.states : [];
      base.clues = Array.isArray(saved.clues) ? saved.clues : [];
      base.loop = typeof saved.loop === 'number' ? saved.loop : 1;
      if (saved.checkpoint && STORY.scenes[saved.checkpoint.scene]) {
        base.checkpoint = {
          scene: saved.checkpoint.scene,
          states: Array.isArray(saved.checkpoint.states) ? saved.checkpoint.states : []
        };
      }
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

  function addAll(list, keys) {
    var added = [];
    (keys || []).forEach(function (key) {
      if (list.indexOf(key) === -1) {
        list.push(key);
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
    game.checkpoint = { scene: game.scene, states: game.states.slice() };
    addAll(game.states, choice.set);
    var fresh = addAll(game.clues, choice.learn);
    fresh = fresh.concat(enter(choice.to));
    save();
    render(fresh);
  }

  // 死亡後返回：回到做出致命選擇的那個場景，狀態還原，線索保留。
  function comeBack() {
    var cp = game.checkpoint;
    game.loop += 1;
    if (cp && STORY.scenes[cp.scene]) {
      game.scene = cp.scene;
      game.states = cp.states.slice();
    } else {
      game.scene = STORY.start;
      game.states = [];
    }
    game.checkpoint = null;
    save();
    render([]);
  }

  // 世界結束或路線未完成：回到開場，狀態清空，線索保留。
  function startOver() {
    game.loop += 1;
    game.scene = STORY.start;
    game.states = [];
    game.checkpoint = null;
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
    var scene = STORY.scenes[game.scene];

    el.scene.classList.remove('enter', 'is-death', 'is-end');
    void el.scene.offsetWidth; // 讓進場動畫重新播放
    el.scene.classList.add('enter');

    el.kicker.textContent = '';
    if (scene.death) {
      el.scene.classList.add('is-death');
      el.kicker.textContent = '你死了';
    } else if (scene.worldEnd) {
      el.scene.classList.add('is-end');
      el.kicker.textContent = '世界結束';
    }

    el.sceneTitle.textContent = fill(scene.title);

    el.sceneText.textContent = '';
    (scene.text || []).forEach(function (para) {
      var p = document.createElement('p');
      p.textContent = fill(para);
      el.sceneText.appendChild(p);
    });

    el.learned.textContent = '';
    (freshClues || []).forEach(function (key) {
      var li = document.createElement('li');
      li.textContent = fill(STORY.clues[key] || key);
      el.learned.appendChild(li);
    });

    el.choices.textContent = '';
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

    el.loop.textContent = game.loop > 1 ? '第 ' + game.loop + ' 輪' : '';
    el.notesCount.textContent = game.clues.length ? String(game.clues.length) : '';
    disarmReset();

    var first = el.choices.querySelector('button');
    if (first && document.activeElement && document.activeElement !== document.body) {
      first.focus({ preventScroll: true });
    }
    window.scrollTo(0, 0);
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
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && !el.notes.hidden) closeNotes();
  });
  el.reset.addEventListener('click', onReset);

  /* ── 開始 ── */

  el.title.textContent = STORY.title;
  el.subtitle.textContent = STORY.subtitle;
  var opening = game.scene === STORY.start && game.loop === 1 && !game.clues.length
    ? enter(STORY.start)
    : [];
  save();
  render(opening);
})();
