// Tiny DOM helpers shared by the screens.
export const $ = (id) => document.getElementById(id);

export function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c !== null && c !== undefined && c !== false));
  return node;
}

export function button(text, onClick, className = 'btn') {
  const b = el('button', { className, type: 'button', textContent: text });
  b.addEventListener('click', onClick);
  return b;
}

export function tappable(node, onTap) {
  node.classList.add('tappable');
  node.addEventListener('click', onTap);
  return node;
}
