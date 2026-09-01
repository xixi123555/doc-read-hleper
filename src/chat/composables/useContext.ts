/**
 * 页面上下文：向宿主请求 / 读取当前网页解析结果，供问答与展示。
 */
import { ref } from 'vue'
import type { Ref } from 'vue'
import type { PageContext } from '../../shared/types'
import { CTX_KEY_PREFIX, PM } from '../../shared/msg'
import { logger } from '../../shared/logger'

export function useContext(deps: {
  nonce: Ref<string>
  postToHost: (msg: any) => void
}) {
  const pageContext = ref<PageContext | null>(null)
  let ctxResolver: (() => void) | null = null

  /** 请求宿主刷新上下文；3s 超时回退 storage.session 或已有缓存 */
  function ensureContext(): Promise<PageContext | null> {
    return new Promise((resolve) => {
      if (!deps.nonce.value) {
        logger.warn('chat', '尚未收到宿主初始化（nonce 为空），跳过上下文请求')
        resolve(pageContext.value || null)
        return
      }
      ctxResolver = () => {
        void readCtx().then(resolve)
      }
      deps.postToHost({ type: PM.GetContext, nonce: deps.nonce.value })
      logger.debug('chat', '已请求刷新页面上下文', { nonce: deps.nonce.value.slice(0, 6) })
      window.setTimeout(() => {
        if (ctxResolver) {
          ctxResolver = null
          logger.warn('chat', '等待上下文超时（3s），使用已有上下文或空')
          void readCtx().then(resolve)
        }
      }, 3000)
    })
  }

  async function readCtx(): Promise<PageContext | null> {
    try {
      const data = await chrome.storage.session.get(CTX_KEY_PREFIX + deps.nonce.value)
      const v = data[CTX_KEY_PREFIX + deps.nonce.value]
      if (v?.ctx) {
        pageContext.value = v.ctx
        logger.debug('chat', '从 storage.session 读取到上下文', {
          title: v.ctx.title,
          textLen: v.ctx.text.length,
        })
        return v.ctx
      }
      logger.warn('chat', 'storage.session 未读到上下文', { key: CTX_KEY_PREFIX + deps.nonce.value })
    } catch (e) {
      logger.warn('chat', 'storage.session 读取异常', e)
    }
    return pageContext.value || null
  }

  /** 宿主 ContextReady 消息：直接写入或回退读取，并 resolve 等待者 */
  function applyContextReady(msg: any) {
    if (msg.ctx) {
      pageContext.value = msg.ctx
      logger.info('chat', '已收到页面上下文（消息直投）', {
        title: msg.ctx.title,
        textLen: msg.ctx.text.length,
        wordCount: msg.ctx.wordCount,
      })
    } else {
      logger.warn('chat', 'ContextReady 未携带上下文，回退读取 storage.session')
      void readCtx().catch(() => undefined)
    }
    if (ctxResolver) {
      const r = ctxResolver
      ctxResolver = null
      r()
    }
  }

  return { pageContext, ensureContext, applyContextReady }
}
