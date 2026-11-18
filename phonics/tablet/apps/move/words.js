/* Move to Learn — the Spelling Pop word lists, one per grade, a picture for each (an emoji, so the tile carries its own art).
   The same lists as the TV game (Leaning Move Game for TV, game/index.html). 2nd grade ends with a few sight words that are
   only spoken (no picture). make-voice.py reads this file: every word here needs its clip voice/w_<word>.mp3 (D-010: whole
   words by Piper, made once on the laptop) — add a word, run make-voice.py, commit both. */
window.MOVE_WORDS = {
 K: [['cat','🐱'],['dog','🐶'],['sun','☀️'],['pig','🐷'],['bus','🚌'],['hat','🎩'],['cup','☕'],['bed','🛏️'],
     ['fox','🦊'],['egg','🥚'],['bat','🦇'],['cow','🐮'],['ant','🐜'],['bug','🐞'],['map','🗺️'],['pen','🖊️'],
     ['box','📦'],['car','🚗'],['hen','🐔'],['jam','🍯'],['owl','🦉'],['pan','🍳'],['web','🕸️'],['zip','🤐']],
 1: [['ship','🚢'],['frog','🐸'],['fish','🐟'],['duck','🦆'],['crab','🦀'],['drum','🥁'],['flag','🚩'],['shell','🐚'],
     ['clock','🕐'],['truck','🚚'],['sock','🧦'],['milk','🥛'],['nest','🪺'],['ring','💍'],['star','⭐'],['tree','🌳'],
     ['snake','🐍'],['hand','✋'],['moon','🌙'],['bell','🔔'],['king','🤴'],['chick','🐥'],['brush','🪥'],['crown','👑'],
     ['swim','🏊'],['ghost','👻'],['plant','🪴'],['lamp','🛋️']],
 2: [['cake','🎂'],['whale','🐳'],['grapes','🍇'],['mouse','🐭'],['house','🏠'],['boat','⛵'],['rain','🌧️'],['train','🚆'],
     ['bike','🚲'],['kite','🪁'],['snail','🐌'],['cloud','☁️'],['plane','✈️'],['sheep','🐑'],['cheese','🧀'],['bread','🍞'],
     ['pizza','🍕'],['robot','🤖'],['tiger','🐯'],['flower','🌸'],['rocket','🚀'],['candle','🕯️'],['koala','🐨'],['panda','🐼'],
     ['zebra','🦓'],['said',''],['they',''],['when',''],['what',''],['want',''],['because',''],['friend','']]
};
