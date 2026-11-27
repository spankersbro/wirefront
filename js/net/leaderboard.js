// The shared top-ten leaderboard in Firestore, and saving a score (WF-34).
import { G } from '../state.js';
import { playBlip } from '../audio.js';
/* ════════════════════════ leaderboard (db) ════════════════════════ */
export let db = null;
export let topScores = [];
// Set by the ?e2e hooks that change the game: a tab that used one never saves a score.
export let scoreSavingBlocked = false;
export function blockScoreSaving() {
  scoreSavingBlocked = true;
}
export const lbInitialsStep = document.getElementById('initialsStep');
export const lbGameOverOverlay = document.getElementById('gameOverOverlay');
// After firebase.initializeApp: read the shared top ten, or show the board as offline.
export function connectLeaderboard() {
  try {
    db = firebase.firestore();
    subscribeLeaderboard();
  } catch {
    db = null;
    renderBoard(document.getElementById('titleBoard'));
  }
}
export function renderBoard(el) {
  if (!db) {
    el.innerHTML = '<div class="empty-board">Offline — scores not saved this session</div>';
    return;
  }
  if (!topScores.length) {
    el.innerHTML = '<div class="empty-board">No runs recorded yet. Be the first.</div>';
    return;
  }
  var rows = topScores
    .map(function (s, i) {
      return (
        '<tr><td>' +
        (i + 1) +
        '</td><td>' +
        escapeHtml(s.initials || '???') +
        '</td><td>' +
        (s.score || 0) +
        '</td></tr>'
      );
    })
    .join('');
  el.innerHTML = '<table class="scores">' + rows + '</table>';
}
export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// firestore.rules refuses the same list; change both together.
export const BLOCKED_INITIALS = [
  'ASS',
  'CNT',
  'CUM',
  'DIC',
  'DIK',
  'FAG',
  'FCK',
  'FKN',
  'FKU',
  'FUC',
  'FUK',
  'FUQ',
  'FUT',
  'HH',
  'KKK',
  'KYS',
  'KZ',
  'NIG',
  'SEX',
  'SHT',
  'SS',
  'TIT',
];
export const initialsError = document.getElementById('initialsError');

export function showInitialsError(show) {
  initialsError.hidden = !show;
  document.getElementById('initials').setAttribute('aria-invalid', String(show));
}

export function submitScore() {
  var raw = document.getElementById('initials').value || 'ACE';
  var initials =
    raw
      .toUpperCase()
      .replace(/[^A-Z]/g, '')
      .slice(0, 3) || 'ACE';
  if (BLOCKED_INITIALS.indexOf(initials) > -1) {
    showInitialsError(true);
    return;
  }
  playBlip();
  if (db && !scoreSavingBlocked) {
    db.collection('scores')
      .add({ initials: initials, score: G.score, wave: G.wave, ts: Date.now() })
      .catch(function () {});
  }
  lbInitialsStep.style.display = 'none';
}
document.getElementById('submitScoreBtn').addEventListener('click', submitScore);
document.getElementById('initials').addEventListener('keydown', function (ev) {
  if (ev.key === 'Enter') {
    ev.preventDefault();
    submitScore();
  }
});
document.getElementById('initials').addEventListener('input', function (ev) {
  ev.target.value = ev.target.value
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3);
  showInitialsError(false);
});

export function subscribeLeaderboard() {
  if (!db) return;
  db.collection('scores')
    .orderBy('score', 'desc')
    .limit(10)
    .onSnapshot(
      function (snap) {
        topScores = snap.docs.map(function (d) {
          return d.data();
        });
        renderBoard(document.getElementById('titleBoard'));
        if (!lbGameOverOverlay.hidden) renderBoard(document.getElementById('goBoard'));
      },
      function () {
        /* leave topScores as-is */
      },
    );
}
