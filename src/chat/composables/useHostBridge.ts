/**
 * 宿主通信与窗口控制：持有 nonce / 页面状态，提供 postToHost 与窗口控制
 * （拖拽 / 缩放 / 收起 / 全屏 / 关闭）。
 */
import { ref } from 'vue'
import { PM } from '../../shared/msg'

export function useHostBridge() {
  const nonce = ref('')
  const initialized = ref(false)
  const isCollapsed = ref(false)
  const fullscreenLocal = ref(false)
  const pluginActive = ref(true)
  const domain = ref('')
  const pageTitle = ref('')
  const pageUrl = ref('')
  const tabId = ref(0)

  function postToHost(msg: any) {
    window.parent.postMessage(msg, '*')
  }

  /* ---------------- 窗口控制 ---------------- */

  function collapse() {
    postToHost({ type: PM.Collapse, nonce: nonce.value })
  }
  function expand() {
    postToHost({ type: PM.Expand, nonce: nonce.value })
  }
  function toggleFullscreen() {
    fullscreenLocal.value = !fullscreenLocal.value
    postToHost({ type: PM.Fullscreen, nonce: nonce.value, fullscreen: fullscreenLocal.value })
  }
  function closeWindow() {
    postToHost({ type: PM.Close, nonce: nonce.value })
  }

  /**
   * 浮窗拖拽：双击不松开才能拖动（500ms / 6px 容差的第二次按下才发送 DragStart），
   * 单击顶栏只记录按下位置/时间，不触发拖动。
   */
  const DRAG_DBLCLICK_MS = 500
  const DRAG_DBLCLICK_DIST = 6
  let lastHeadPress = { x: -1, y: -1, t: 0 }

  function onHeadDragDown(e: MouseEvent) {
    if (isCollapsed.value || fullscreenLocal.value) return
    if ((e.target as HTMLElement).closest('button')) return
    const now = Date.now()
    const prev = lastHeadPress
    lastHeadPress = { x: e.clientX, y: e.clientY, t: now }
    const isSecondPress =
      now - prev.t <= DRAG_DBLCLICK_MS &&
      Math.abs(e.clientX - prev.x) <= DRAG_DBLCLICK_DIST &&
      Math.abs(e.clientY - prev.y) <= DRAG_DBLCLICK_DIST
    if (isSecondPress) postToHost({ type: PM.DragStart, nonce: nonce.value })
  }

  function onResizeDown(e: MouseEvent) {
    e.preventDefault()
    postToHost({ type: PM.ResizeStart, nonce: nonce.value })
  }

  /* ---------------- 宿主初始化 / 页面切换 ---------------- */

  /** 应用宿主 Init 消息（携带 nonce 建立信任） */
  function applyInit(msg: any) {
    nonce.value = msg.nonce
    tabId.value = msg.tabId
    pluginActive.value = !!msg.pluginActive
    isCollapsed.value = msg.state === 'collapsed'
    fullscreenLocal.value = !!msg.fullscreen
    domain.value = msg.domain
    pageTitle.value = msg.pageTitle
    pageUrl.value = msg.url
    initialized.value = true
  }

  /** 页面变化时更新状态，返回域名是否变化 */
  function applyPageChanged(msg: any): boolean {
    const changed = msg.domain !== domain.value
    domain.value = msg.domain
    pageTitle.value = msg.pageTitle
    pageUrl.value = msg.url
    return changed
  }

  return {
    nonce,
    initialized,
    isCollapsed,
    fullscreenLocal,
    pluginActive,
    domain,
    pageTitle,
    pageUrl,
    tabId,
    postToHost,
    collapse,
    expand,
    toggleFullscreen,
    closeWindow,
    onHeadDragDown,
    onResizeDown,
    applyInit,
    applyPageChanged,
  }
}
