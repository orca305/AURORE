export function ShortTitle({text}:{text:string}){const letters=Array.from(text);return <span title={text} aria-label={text}>{letters.length>30?letters.slice(0,30).join('')+'...':text}</span>;}
