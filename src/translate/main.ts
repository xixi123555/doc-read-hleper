import { createApp } from 'vue'
import App from './App.vue'
import '../shared/tailwind.css'
import '../shared/theme.css'
import { getSettings } from '../shared/storage'
import { applyTheme } from '../shared/theme'

void getSettings().then((s) => {
  applyTheme(s.theme)
})

createApp(App).mount('#app')
