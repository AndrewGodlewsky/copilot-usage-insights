import { esc } from './charts.mjs';
import { tokenTopicIcon } from './token-topics.mjs';

export function createTopicExplorer(prefix, rangeId, topics, initial, onSelect, { getElement }) {
  let selected = initial;
  const lens = getElement(rangeId), stops = getElement(`${prefix}-topic-stops`), nodes = getElement(`${prefix}-track-nodes`);
  lens.max = String(topics.length - 1);
  getElement(`${prefix}-track-inner`).style.setProperty('--token-topic-count', topics.length);
  nodes.innerHTML = topics.map(topic => `<span data-${prefix}-node="${topic.id}"></span>`).join('');
  stops.innerHTML = topics.map(topic => `<button data-${prefix}-stop="${topic.id}" title="${esc(topic.label)}" aria-label="${esc(topic.label)}" aria-controls="${prefix}-topic-content">${tokenTopicIcon(topic)}</button>`).join('');
  function sync() {
    const index = topics.findIndex(topic => topic.id === selected), topic = topics[index];
    lens.value = String(index);
    lens.title = topic.label;
    lens.style.setProperty('--lens-icon', `url("data:image/svg+xml,${encodeURIComponent(tokenTopicIcon(topic, true))}")`);
    lens.setAttribute('aria-valuetext', `${topic.label}, section ${index + 1} of ${topics.length}`);
    for (const button of stops.querySelectorAll(`[data-${prefix}-stop]`)) button.setAttribute('aria-current', String(button.dataset[`${prefix}Stop`] === selected));
    for (const node of nodes.querySelectorAll(`[data-${prefix}-node]`)) node.classList.toggle('current', node.dataset[`${prefix}Node`] === selected);
    getElement(`${prefix}-topic-position`).textContent = `${topic.group || (prefix === 'token' ? 'Summary' : 'Patterns')} · ${index + 1} of ${topics.length}`;
    getElement(`${prefix}-selected-title`).textContent = topic.label;
    getElement(`${prefix}-topic-prev`).disabled = index === 0;
    getElement(`${prefix}-topic-next`).disabled = index === topics.length - 1;
  }
  function select(id, announce = false) {
    const topic = topics.find(topic => topic.id === id);
    if (!topic || selected === id) return;
    selected = id;
    sync();
    // Keep short panels from shrinking the document past the current viewport during navigation.
    const content = getElement(`${prefix}-topic-content`);
    content.style.minHeight = `${Math.max(0, (document.documentElement.clientHeight || innerHeight) - Math.max(0, content.getBoundingClientRect().top))}px`;
    onSelect(id);
    if (announce) getElement(`${prefix}-topic-announcement`).textContent = `Showing ${topic.label}`;
  }
  lens.oninput = () => select(topics[Number(lens.value)]?.id);
  lens.onkeydown = event => {
    const index = topics.findIndex(topic => topic.id === selected);
    const keys = { ArrowRight: index + 1, ArrowUp: index + 1, ArrowLeft: index - 1, ArrowDown: index - 1, Home: 0, End: topics.length - 1 };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(topics[Math.max(0, Math.min(topics.length - 1, keys[event.key]))].id);
  };
  stops.onclick = event => select(event.target.closest(`[data-${prefix}-stop]`)?.dataset[`${prefix}Stop`], true);
  for (const [direction, step] of [['prev', -1], ['next', 1]]) {
    const button = getElement(`${prefix}-topic-${direction}`);
    button.onclick = () => {
      const focused = document.activeElement === button;
      const index = topics.findIndex(topic => topic.id === selected);
      select(topics[index + step]?.id, true);
      if (button.disabled && focused) lens.focus({ preventScroll: true });
    };
  }
  sync();
  return select;
}
