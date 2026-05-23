let root: HTMLDivElement | null = null
function getRoot() {
  if (!root) {
    root = document.createElement('div')
    root.id = 'toast-root'
    document.body.appendChild(root)
  }
  return root
}
export function toast(msg: string, type: 'info'|'success'|'warning'|'critical' = 'info', ms = 3500) {
  const el = document.createElement('div')
  el.className = `toast toast-${type}`
  el.textContent = msg
  getRoot().appendChild(el)
  setTimeout(() => { el.style.opacity='0'; el.style.transition='opacity .3s'; setTimeout(()=>el.remove(),300) }, ms)
}
