// The comms feed: the short lines for joins, leaves and Gemini orders (WF-34).
import { MAX_COMMS_LINES } from './config.js';

const commsFeed = document.getElementById('commsFeed');

export function showCommsLine(text, kind){
  var line = document.createElement('div');
  line.className = 'comms-line' + (kind === 'leave' || kind === 'gemini' ? ' ' + kind : '');
  line.textContent = text;
  commsFeed.appendChild(line);
  requestAnimationFrame(function(){ line.classList.add('show'); });
  while (commsFeed.children.length > MAX_COMMS_LINES){
    commsFeed.removeChild(commsFeed.firstChild);
  }
  setTimeout(function(){
    line.classList.remove('show');
    setTimeout(function(){ if (line.parentNode) line.parentNode.removeChild(line); }, 400);
  }, 3200);
}
