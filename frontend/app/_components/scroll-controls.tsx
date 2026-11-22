"use client";
import {useEffect,useState} from "react";
import styles from "./scroll-controls.module.css";
export function ScrollControls(){
 const [state,setState]=useState({visible:false,top:true,bottom:true});
 useEffect(()=>{const update=()=>{const max=Math.max(0,document.documentElement.scrollHeight-innerHeight);const next={visible:max>8,top:scrollY<=4,bottom:scrollY>=max-4};setState(previous=>previous.visible===next.visible&&previous.top===next.top&&previous.bottom===next.bottom?previous:next);};const observer=new ResizeObserver(update);observer.observe(document.body);window.addEventListener('scroll',update,{passive:true});window.addEventListener('resize',update);update();return()=>{observer.disconnect();window.removeEventListener('scroll',update);window.removeEventListener('resize',update);};},[]);
 if(!state.visible)return null;
 const move=(bottom:boolean)=>window.scrollTo({top:bottom?document.documentElement.scrollHeight:0,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
 const chevron = (down: boolean) => <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={down ? "m6 9 6 6 6-6" : "m6 15 6-6 6 6"} /></svg>;
 return <nav className={styles.controls} aria-label="페이지 스크롤 이동"><button type="button" disabled={state.top} onClick={()=>move(false)} aria-label="맨 위로 이동" title="맨 위로">{chevron(false)}</button><button type="button" disabled={state.bottom} onClick={()=>move(true)} aria-label="맨 아래로 이동" title="맨 아래로">{chevron(true)}</button></nav>;
}
