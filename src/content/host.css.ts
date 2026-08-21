/** 注入宿主页面的 Shadow DOM 样式（隔离，不污染原生网页样式） */
export const HOST_STYLE = `
#chat {
  position: fixed;
  right: 16px;
  top: 16px;
  width: 380px;
  height: 640px;
  z-index: 2147483647;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 10px 40px rgba(15, 23, 42, 0.22), 0 2px 8px rgba(15, 23, 42, 0.10);
  display: none;
  background: transparent;
  pointer-events: auto;
  transition: border-radius 0.15s ease;
}
#chat.collapsed {
  width: 56px;
  height: 56px;
  border-radius: 50%;
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.25);
  cursor: pointer;
}
#chat.fullscreen {
  left: 8px;
  top: 8px;
  right: 8px;
  bottom: 8px;
  width: auto;
  height: auto;
  border-radius: 14px;
}
#chat iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
  background: transparent;
}
#translate {
  position: fixed;
  width: 340px;
  z-index: 2147483646;
  border-radius: 10px;
  overflow: hidden;
  box-shadow: 0 8px 30px rgba(15, 23, 42, 0.20), 0 2px 6px rgba(15, 23, 42, 0.10);
  display: none;
  background: transparent;
  pointer-events: auto;
}
#translate iframe {
  width: 100%;
  height: 100%;
  border: 0;
  display: block;
}
`
