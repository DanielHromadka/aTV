import { mount } from 'svelte'
import App from './App.svelte'
import './app.css'
import { connectHub } from './lib/hub.svelte.ts'

connectHub()
mount(App, { target: document.getElementById('app')! })
