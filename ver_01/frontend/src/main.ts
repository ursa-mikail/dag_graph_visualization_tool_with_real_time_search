import './styles/global.css';
import { App } from './components/App';

const root = document.getElementById('app')!;
const app = new App(root);
app.init();
