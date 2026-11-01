import { QUESTIONS, TOPICS } from './questions.mjs';

const STORAGE_KEY = 'dataminin-attempts-v1';
const byId = new Map(QUESTIONS.map(question => [question.id, question]));
const $ = id => document.getElementById(id);
const shuffle = values => {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};

function validEvent(item) {
  return item && typeof item === 'object' && byId.has(item.questionId)
    && Number.isInteger(item.selected) && item.selected >= 0 && item.selected < 4
    && typeof item.at === 'string' && !Number.isNaN(Date.parse(item.at));
}

function loadEvents() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(validEvent).map(item => ({
      id: typeof item.id === 'string' ? item.id : `${item.questionId}-${item.at}-${item.selected}`,
      questionId: item.questionId,
      selected: item.selected,
      at: item.at,
      correct: item.selected === byId.get(item.questionId).answer,
    }));
  } catch { return []; }
}

let events = loadEvents();
let session = null;
let mistakeFilter = 'due';
let toastTimer;

function saveEvents() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(events));
    return true;
  } catch {
    showToast('瀏覽器儲存空間不足，請先匯出紀錄備份。');
    return false;
  }
}

function showToast(message) {
  const toast = $('toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3700);
}

function questionRecord(questionId) {
  const attempts = events.filter(item => item.questionId === questionId);
  const wrong = attempts.filter(item => !item.correct);
  if (!wrong.length) return { attempts, wrong, streak: 0, due: false };
  let streak = 0;
  for (let i = attempts.length - 1; i >= 0 && attempts[i].correct; i--) streak++;
  return { attempts, wrong, streak, due: streak < 2, lastWrong: wrong.at(-1) };
}

function summary() {
  const correct = events.filter(event => event.correct).length;
  const everWrong = QUESTIONS.filter(question => questionRecord(question.id).wrong.length > 0);
  const due = everWrong.filter(question => questionRecord(question.id).due);
  return { correct, everWrong, due, accuracy: events.length ? Math.round(correct / events.length * 100) : null };
}

function updateCounters() {
  const stats = summary();
  $('questionCount').textContent = QUESTIONS.length;
  $('attemptCount').textContent = events.length;
  $('accuracyCount').textContent = stats.accuracy === null ? '—' : `${stats.accuracy}%`;
  $('dueCount').textContent = stats.due.length;
  $('dueBadge').textContent = stats.due.length;
  $('dueBadge').hidden = stats.due.length === 0;
  $('mistakeDueCount').textContent = stats.due.length;
  $('recordAttempts').textContent = events.length;
  $('recordAccuracy').textContent = stats.accuracy === null ? '—' : `${stats.accuracy}%`;
  $('recordEver').textContent = stats.everWrong.length;
  $('recordDue').textContent = stats.due.length;
}

function setView(view) {
  for (const name of ['practice', 'mistakes', 'progress']) {
    $(`${name}View`).hidden = name !== view;
  }
  document.querySelectorAll('.nav-link').forEach(link => {
    link.classList.toggle('active', link.dataset.view === view);
    if (link.dataset.view === view) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  if (view === 'mistakes') renderMistakes();
  if (view === 'progress') renderProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function deckFor(mode, topic) {
  let pool = QUESTIONS.filter(question => topic === 'all' || question.topic === topic);
  if (mode === 'due') pool = pool.filter(question => questionRecord(question.id).due);
  if (mode === 'ever') pool = pool.filter(question => questionRecord(question.id).wrong.length);
  if (mode === 'due' || mode === 'ever') {
    pool = shuffle(pool).sort((a, b) => questionRecord(b.id).wrong.length - questionRecord(a.id).wrong.length);
  } else {
    pool = shuffle(pool);
  }
  return mode === 'quick' ? pool.slice(0, 20) : pool;
}

function balancedOrders(deck) {
  const slots = shuffle(Array.from({ length: deck.length }, (_, index) => index % 4));
  const orders = new Map();
  deck.forEach((question, index) => {
    const wrongIndices = shuffle([0, 1, 2, 3].filter(choice => choice !== question.answer));
    wrongIndices.splice(slots[index], 0, question.answer);
    orders.set(question.id, wrongIndices);
  });
  return orders;
}

function startSession(mode = $('modeSelect').value, topic = $('topicSelect').value) {
  const deck = deckFor(mode, topic);
  if (!deck.length) {
    showToast(mode === 'due' || mode === 'ever' ? '目前沒有符合範圍的錯題。' : '目前沒有符合範圍的題目。');
    return;
  }
  session = { deck, orders: balancedOrders(deck), index: 0, answered: false, correct: 0, wrong: 0, mode };
  $('modeSelect').value = mode;
  $('topicSelect').value = topic;
  $('quizArea').hidden = false;
  $('sessionDone').hidden = true;
  setView('practice');
  renderQuestion();
  $('quizArea').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function makeOption(label, text, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'option';
  const letter = document.createElement('span');
  letter.className = 'option-letter';
  letter.textContent = label;
  const value = document.createElement('span');
  value.textContent = text;
  button.append(letter, value);
  button.addEventListener('click', onClick);
  return button;
}

function renderQuestion() {
  const question = session.deck[session.index];
  const order = session.orders.get(question.id);
  session.answered = false;
  $('sessionLabel').textContent = session.mode === 'due' ? '待加強複習' : session.mode === 'ever' ? '曾錯題複習' : '觀念練習中';
  $('progressFill').style.width = `${session.index / session.deck.length * 100}%`;
  document.querySelector('.progress-track').setAttribute('aria-valuenow', String(Math.round(session.index / session.deck.length * 100)));
  $('cardNumber').textContent = `${String(session.index + 1).padStart(2, '0')} / ${String(session.deck.length).padStart(2, '0')}`;
  $('cardTopic').textContent = question.topic;
  $('questionPrompt').textContent = question.prompt;
  const options = $('options');
  options.replaceChildren();
  order.forEach((originalIndex, displayIndex) => {
    options.append(makeOption('ABCD'[displayIndex], question.choices[originalIndex].text, () => answerQuestion(originalIndex)));
  });
  $('feedback').hidden = true;
  $('feedback').className = 'feedback';
  $('explanation').hidden = true;
  $('explainButton').hidden = true;
  $('explainButton').textContent = '查看逐項詳解 ⌄';
  $('nextButton').hidden = true;
  $('nextButton').textContent = session.index === session.deck.length - 1 ? '查看本回合結果 →' : '下一題 →';
}

function answerQuestion(originalIndex) {
  if (!session || session.answered) return;
  const question = session.deck[session.index];
  session.answered = true;
  const correct = originalIndex === question.answer;
  if (correct) session.correct++;
  else session.wrong++;
  events.push({
    id: crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`,
    questionId: question.id, selected: originalIndex,
    at: new Date().toISOString(), correct,
  });
  saveEvents();
  updateCounters();
  const order = session.orders.get(question.id);
  [...$('options').children].forEach((button, displayIndex) => {
    const index = order[displayIndex];
    button.disabled = true;
    if (index === question.answer) button.classList.add('correct');
    else if (index === originalIndex) button.classList.add('incorrect');
    else button.classList.add('dimmed');
  });
  const feedback = $('feedback');
  feedback.hidden = false;
  feedback.classList.add(correct ? 'good' : 'bad');
  feedback.textContent = correct
    ? '答對了。打開逐項詳解，再確認其他選項為什麼不適用。'
    : `答錯了。正確答案是「${question.choices[question.answer].text}」。這題已加入錯題本。`;
  renderExplanation($('explanationRows'), question, order, originalIndex);
  $('explainButton').hidden = false;
  $('nextButton').hidden = false;
}

function renderExplanation(container, question, order, pickedIndex) {
  container.replaceChildren();
  order.forEach((originalIndex, displayIndex) => {
    const row = document.createElement('div');
    row.className = 'explain-row';
    if (originalIndex === question.answer) row.classList.add('is-answer');
    if (originalIndex === pickedIndex) row.classList.add('is-picked');
    const letter = document.createElement('span');
    letter.className = 'explain-letter';
    letter.textContent = 'ABCD'[displayIndex];
    const body = document.createElement('div');
    const title = document.createElement('strong');
    title.textContent = `${question.choices[originalIndex].text}${originalIndex === question.answer ? '  ✓ 正確' : ''}`;
    const reason = document.createElement('p');
    reason.textContent = question.choices[originalIndex].why;
    body.append(title, reason);
    row.append(letter, body);
    container.append(row);
  });
}

function finishSession() {
  if (!session) return;
  $('quizArea').hidden = true;
  $('sessionDone').hidden = false;
  $('doneSummary').textContent = `本回合已作答 ${session.correct + session.wrong} 題，答對 ${session.correct} 題、答錯 ${session.wrong} 題。現在有 ${summary().due.length} 題待加強。`;
  $('sessionDone').scrollIntoView({ behavior: 'smooth', block: 'center' });
  session = null;
}

function renderMistakes() {
  const stats = summary();
  const selected = mistakeFilter === 'due' ? stats.due : stats.everWrong;
  $('mistakeListCount').textContent = `共 ${selected.length} 題`;
  const list = $('mistakeList');
  list.replaceChildren();
  if (!selected.length) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = mistakeFilter === 'due' ? '目前沒有待加強題目。繼續練習，保持手感。' : '目前沒有答錯紀錄。完成一回合後，這裡會記住你的選擇。';
    list.append(empty);
    return;
  }
  const ranked = [...selected].sort((a, b) => {
    const count = questionRecord(b.id).wrong.length - questionRecord(a.id).wrong.length;
    return count || Date.parse(questionRecord(b.id).lastWrong.at) - Date.parse(questionRecord(a.id).lastWrong.at);
  });
  ranked.forEach(question => {
    const record = questionRecord(question.id);
    const item = document.createElement('article');
    item.className = 'mistake-item';
    const top = document.createElement('div');
    top.className = 'mistake-top';
    const left = document.createElement('div');
    const topic = document.createElement('span');
    topic.className = 'topic-tag';
    topic.textContent = `${question.topic} · ${question.focus}`;
    const title = document.createElement('h3');
    title.textContent = question.prompt;
    left.append(topic, title);
    const state = document.createElement('span');
    state.className = `state-tag${record.due ? '' : ' done-state'}`;
    state.textContent = record.due ? `再答對 ${2 - record.streak} 次` : '已掌握';
    top.append(left, state);
    const choices = document.createElement('div');
    choices.className = 'mistake-choice';
    const wrong = document.createElement('span');
    wrong.append('上次選錯：');
    const wrongValue = document.createElement('b');
    wrongValue.textContent = question.choices[record.lastWrong.selected].text;
    wrong.append(wrongValue);
    const right = document.createElement('span');
    right.append('正確答案：');
    const rightValue = document.createElement('b');
    rightValue.textContent = question.choices[question.answer].text;
    right.append(rightValue);
    const count = document.createElement('span');
    count.textContent = `累計答錯 ${record.wrong.length} 次`;
    choices.append(wrong, right, count);
    const details = document.createElement('details');
    const summaryNode = document.createElement('summary');
    summaryNode.textContent = '重新看逐項詳解';
    const explanation = document.createElement('div');
    renderExplanation(explanation, question, [0, 1, 2, 3], record.lastWrong.selected);
    details.append(summaryNode, explanation);
    item.append(top, choices, details);
    list.append(item);
  });
}

function renderProgress() {
  const topicStats = $('topicStats');
  topicStats.replaceChildren();
  const rows = TOPICS.map(topic => {
    const topicIds = new Set(QUESTIONS.filter(question => question.topic === topic).map(question => question.id));
    const attempts = events.filter(event => topicIds.has(event.questionId));
    const accuracy = attempts.length ? Math.round(attempts.filter(event => event.correct).length / attempts.length * 100) : null;
    return { topic, attempts: attempts.length, accuracy };
  }).sort((a, b) => (a.accuracy ?? 101) - (b.accuracy ?? 101));
  rows.forEach(row => {
    const item = document.createElement('div'); item.className = 'topic-stat';
    const name = document.createElement('span'); name.textContent = row.topic;
    const bar = document.createElement('div'); bar.className = 'bar';
    const fill = document.createElement('span'); fill.style.width = `${row.accuracy ?? 0}%`;
    bar.append(fill);
    const value = document.createElement('b'); value.textContent = row.accuracy === null ? '未作答' : `${row.accuracy}%`;
    item.append(name, bar, value); topicStats.append(item);
  });
  const history = $('historyList'); history.replaceChildren();
  if (!events.length) {
    const empty = document.createElement('div'); empty.className = 'empty';
    empty.textContent = '尚無作答紀錄。開始練習後，每次作答都會出現在這裡。';
    history.append(empty); return;
  }
  [...events].reverse().slice(0, 30).forEach(event => {
    const question = byId.get(event.questionId);
    const row = document.createElement('div'); row.className = 'history-row';
    const date = document.createElement('span');
    date.textContent = new Intl.DateTimeFormat('zh-TW', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(event.at));
    const description = document.createElement('strong');
    description.textContent = `${question.focus} · 選了 ${question.choices[event.selected].text}`;
    const result = document.createElement('span'); result.className = `result${event.correct ? '' : ' wrong'}`;
    result.textContent = event.correct ? '答對' : '答錯';
    row.append(date, description, result); history.append(row);
  });
}

function exportRecords() {
  const data = JSON.stringify({ app: 'dataminin', version: 1, exportedAt: new Date().toISOString(), events }, null, 2);
  const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = `dataminin-record-${new Date().toISOString().slice(0, 10)}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  $('storageMessage').textContent = `已匯出 ${events.length} 筆作答紀錄。`;
}

async function importRecords(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (data.app !== 'dataminin' || !Array.isArray(data.events)) throw new Error('格式不符');
    if (data.events.some(item => !validEvent(item))) throw new Error('紀錄內容不完整');
    const known = new Set(events.map(item => item.id));
    let added = 0;
    data.events.forEach(item => {
      const id = typeof item.id === 'string' ? item.id : `${item.questionId}-${item.at}-${item.selected}`;
      if (known.has(id)) return;
      known.add(id);
      events.push({ id, questionId: item.questionId, selected: item.selected,
        at: item.at, correct: item.selected === byId.get(item.questionId).answer });
      added++;
    });
    events.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
    saveEvents(); updateCounters(); renderProgress();
    $('storageMessage').textContent = `匯入完成，新增 ${added} 筆紀錄；重複紀錄已略過。`;
    showToast(`已匯入 ${added} 筆紀錄。`);
  } catch {
    $('storageMessage').textContent = '匯入失敗。請選擇由本網站匯出的 JSON 紀錄檔。';
  } finally { $('importInput').value = ''; }
}

function init() {
  TOPICS.forEach(topic => {
    const option = document.createElement('option'); option.value = topic; option.textContent = topic;
    $('topicSelect').append(option);
  });
  updateCounters();
  document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => setView(link.dataset.view)));
  $('heroStart').addEventListener('click', () => startSession('quick', 'all'));
  $('startButton').addEventListener('click', () => startSession());
  $('endButton').addEventListener('click', finishSession);
  $('nextButton').addEventListener('click', () => {
    if (!session?.answered) return;
    session.index++;
    if (session.index === session.deck.length) finishSession(); else renderQuestion();
  });
  $('explainButton').addEventListener('click', () => {
    $('explanation').hidden = !$('explanation').hidden;
    $('explainButton').textContent = $('explanation').hidden ? '查看逐項詳解 ⌄' : '收起逐項詳解 ⌃';
  });
  $('reviewDueButton').addEventListener('click', () => startSession('due', 'all'));
  $('doneReview').addEventListener('click', () => startSession('due', 'all'));
  $('doneAgain').addEventListener('click', () => startSession('quick', 'all'));
  document.querySelectorAll('.segment').forEach(button => button.addEventListener('click', () => {
    mistakeFilter = button.dataset.mistakeFilter;
    document.querySelectorAll('.segment').forEach(item => item.classList.toggle('active', item === button));
    renderMistakes();
  }));
  $('exportButton').addEventListener('click', exportRecords);
  $('importInput').addEventListener('change', event => importRecords(event.target.files[0]));
}

init();
