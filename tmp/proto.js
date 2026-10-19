
const P2 = n => n>=2 && (n&(n-1))===0;
const TYPES=[
 {id:"single-elim",name:"单败",desc:"输一场即淘汰"},
 {id:"double-elim",name:"双败",desc:"输两场才淘汰"},
 {id:"gsl-groups",name:"组内双败",desc:"4 队一组，输两场淘汰，取前 2（旧称 GSL）"},
 {id:"group-single-elim",name:"组内循环",desc:"4 队一组，两两都打，取前 2"},
 {id:"round-robin",name:"单组循环",desc:"全部队伍两两都打（3–6 队）"},
 {id:"swiss",name:"瑞士轮",desc:"同战绩互打，不淘汰，打满轮数取前几名"},
];
const TPL={
 "选择模板":null,
 "16 队 · 小组 + 双败":{teams:16,stages:[
  {name:"小组赛",type:"gsl-groups",advance:8,bo:3},
  {name:"淘汰赛",type:"double-elim",advance:1,bo:5}]},
 "16 队 · 瑞士轮 + 单败":{teams:16,stages:[
  {name:"瑞士轮",type:"swiss",advance:8,bo:1},
  {name:"淘汰赛",type:"single-elim",advance:1,bo:3}]},
 "8 队 · 双败":{teams:8,stages:[
  {name:"双败淘汰",type:"double-elim",advance:1,bo:5}]},
 "32 队 · 小组 + 双败":{teams:32,stages:[
  {name:"小组赛",type:"gsl-groups",advance:16,bo:3},
  {name:"淘汰赛",type:"double-elim",advance:1,bo:5}]},
 "36 队 · 四段（现行）":{teams:36,stages:[
  {name:"资格赛",type:"single-elim",advance:32,bo:1},
  {name:"入围赛",type:"single-elim",advance:16,bo:3},
  {name:"小组赛",type:"gsl-groups",advance:8,bo:3},
  {name:"淘汰赛",type:"single-elim",advance:1,bo:5}]},
};
let state=JSON.parse(JSON.stringify(TPL["36 队四段（现行）"]));
let openIdx=0;

function typeIssue(t,e){
  if(t==="double-elim"&&!P2(e))return "需 2 的幂";
  if(t==="swiss"&&(!P2(e)||e<8))return "需 2 的幂且 ≥8";
  if(t==="round-robin"&&(e<3||e>6))return "仅限 3–6 队";
  if((t==="gsl-groups"||t==="group-single-elim")&&e%4!==0)return "需 4 的倍数";
  return null;
}
function advOpts(t,e){
  if(t==="gsl-groups"||t==="group-single-elim"){const g=e/4;return [g*2].filter(v=>v<e&&v>=1);}
  const o=[];for(let v=1;v<e;v*=2)o.push(v);return o.reverse();
}
function matchesOf(st,e){
  const cut=e-st.advance;
  if(st.type==="single-elim")return cut;
  if(st.type==="double-elim")return cut*2-1;
  if(st.type==="swiss")return Math.round(Math.log2(e))*Math.floor(e/2);
  if(st.type==="round-robin")return e*(e-1)/2;
  return Math.round(e/4)*(st.type==="gsl-groups"?5:6)+Math.max(0,cut-e/4);
}
const entry=i=> i===0?state.teams:state.stages[i-1].advance;

function render(){
  const f=document.getElementById("funnel");
  f.innerHTML="";
  // 漏斗宽度：以最大队数为满宽，逐层收窄
  const maxN = Math.max(state.teams, ...state.stages.map((_,i)=>entry(i)));
  const widthOf = n => `${Math.max(38, Math.round((n / maxN) * 100))}%`;

  const startDiv=document.createElement("div");
  startDiv.className="cap";
  startDiv.style.width = widthOf(state.teams);
  startDiv.innerHTML=`<span class="k">参赛队伍</span><span class="v">${state.teams} 支</span>`;
  f.appendChild(startDiv);

  state.stages.forEach((st,i)=>{
    const e=entry(i);
    const edge=document.createElement("div");
    edge.className="edge";
    edge.innerHTML=`<span class="down">↓</span><span>${matchesOf(st,e)} 场</span><span style="opacity:.45">·</span><span>剩 ${st.advance} 支</span>`;
    f.appendChild(edge);

    const typeName=(TYPES.find(t=>t.id===st.type)||{}).name||"";
    const card=document.createElement("div");
    card.className="stage";
    const open=openIdx===i;
    card.style.width = widthOf(e);
    card.innerHTML=`
      <div class="stage-hd ${open?"open":""}" data-toggle="${i}">
        <span class="name">${st.name}</span>
        <span class="tag">${typeName}</span>
        <span class="tag">BO${st.bo}</span>
        <span class="caret">${open?"▴":"▾"}</span>
        <button class="x" data-del="${i}" aria-label="删除这一段">×</button>
      </div>
      ${open?panelHtml(st,i,e):""}`;
    f.appendChild(card);
  });

  const beforeEnd=document.createElement("div");
  beforeEnd.className="edge";
  const last=state.stages[state.stages.length-1];
  beforeEnd.innerHTML=`<span class="down">↓</span>`;
  if(last) f.appendChild(beforeEnd);
  const end=document.createElement("div");
  end.className="cap";
  end.style.width = widthOf(1);
  end.innerHTML=`<span class="k">冠军</span><span class="v">1 支</span>`;
  f.appendChild(end);

  const {problems,warns}=validate();
  const v=document.getElementById("verdict");
  v.className="verdict "+(problems.length?"bad":warns.length?"warn":"ok");
  document.getElementById("vtitle").textContent=problems.length?"这个赛制打不出来":warns.length?"可以打，有一处不常规":"可以打";
  let total=0;state.stages.forEach((st,i)=>total+=matchesOf(st,entry(i)));
  const lines=problems.length?problems:(warns.length?warns:[]);
  document.getElementById("vbody").innerHTML=lines.map(x=>`· ${x}`).join("<br>")+
    `${lines.length?"<br>":""}<span style="opacity:.75">共 ${state.stages.length} 段 · ${total} 场</span>`;
}

function panelHtml(st,i,e){
  const typeChips=TYPES.map(t=>{
    const issue=typeIssue(t.id,e);
    return `<button class="chip" data-i="${i}" data-set="type" data-v="${t.id}" aria-pressed="${t.id===st.type}" ${issue?"disabled":""}>${t.name}${issue?`（${issue}）`:""}</button>`;
  }).join("");
  const advChips=advOpts(st.type,e).map(v=>`<button class="chip" data-i="${i}" data-set="advance" data-v="${v}" aria-pressed="${v===st.advance}">${v} 支</button>`).join("");
  const boChips=[1,3,5].map(b=>`<button class="chip" data-i="${i}" data-set="bo" data-v="${b}" aria-pressed="${b===st.bo}">BO${b}</button>`).join("");
  const desc=(TYPES.find(t=>t.id===st.type)||{}).desc||"";
  return `<div class="panel">
    <p class="lbl">名称</p>
    <input class="pname" data-i="${i}" data-set="name" value="${st.name}">
    <p class="lbl" style="margin-top:12px">类型</p><div class="chips">${typeChips}</div>
    <p class="desc">${desc}</p>
    <div class="row2">
      <div><p class="lbl">晋级</p><div class="chips">${advChips}</div></div>
      <div><p class="lbl">强度</p><div class="chips">${boChips}</div></div>
    </div>
  </div>`;
}

function validate(){
  const problems=[],warns=[];
  state.stages.forEach((st,i)=>{
    const e=entry(i);
    const issue=typeIssue(st.type,e);
    if(issue)problems.push(`第 ${i+1} 段「${st.name}」：${issue}（进入 ${e} 支）`);
    if(st.advance>=e)problems.push(`第 ${i+1} 段：晋级要少于进入`);
    if(i===state.stages.length-1&&st.advance!==1)problems.push(`第 ${i+1} 段是最后一段，必须剩 1 支`);
    if(i>0&&st.bo<state.stages[i-1].bo)warns.push(`第 ${i+1} 段 BO${st.bo} 低于上一段`);
  });
  if(!state.stages.length)problems.push("至少要有一个赛段");
  return {problems,warns};
}

function renderTemplates(){
  const box=document.getElementById("tmpl");
  box.innerHTML=Object.keys(TPL).filter(k=>TPL[k]).map(k=>
    `<button class="chip" data-tpl="${k}">${k}</button>`).join("");
}
document.addEventListener("click",ev=>{
  const t=ev.target.closest("[data-tpl]");
  if(!t)return;
  const cfg=TPL[t.dataset.tpl];
  if(!cfg)return;
  state=JSON.parse(JSON.stringify(cfg));
  document.getElementById("teams").value=state.teams;
  openIdx=-1;
  render();
});
document.addEventListener("click",ev=>{
  const tog=ev.target.closest("[data-toggle]");
  if(tog&&!ev.target.closest(".x")){ const i=+tog.dataset.toggle; openIdx = openIdx===i?-1:i; render(); return; }
  const chip=ev.target.closest(".chip");
  if(chip){
    const i=+chip.dataset.i,set=chip.dataset.set,st=state.stages[i];
    if(set==="advance")st.advance=+chip.dataset.v;
    else if(set==="bo")st.bo=+chip.dataset.v;
    else if(set==="type"){st.type=chip.dataset.v;const o=advOpts(st.type,entry(i));if(!o.includes(st.advance))st.advance=o[0]??1;
      const SUG={"single-elim":"淘汰赛","double-elim":"双败淘汰","gsl-groups":"小组赛","group-single-elim":"小组赛","round-robin":"循环赛","swiss":"瑞士轮"};
      if(["新赛段","小组赛","淘汰赛","双败淘汰","循环赛","瑞士轮"].includes(st.name))st.name=SUG[st.type]||st.name;}
    render();return;
  }
  const del=ev.target.closest("[data-del]");
  if(del){state.stages.splice(+del.dataset.del,1);openIdx=-1;render();return;}
});
document.addEventListener("input",ev=>{
  if(ev.target.dataset && ev.target.dataset.set==="name"){
    state.stages[+ev.target.dataset.i].name=ev.target.value;
    // 只更新头部文字，不重绘（否则光标会跳）
    const hd=ev.target.closest(".panel")?.previousElementSibling;
    if(hd){const n=hd.querySelector(".name");if(n)n.textContent=ev.target.value;}
  }
});
document.getElementById("teams").oninput=ev=>{state.teams=Math.min(48,Math.max(8,+ev.target.value||8));render();};
document.getElementById("add").onclick=()=>{const l=state.stages[state.stages.length-1];
  state.stages.push({name:"新赛段",type:"single-elim",advance:l?Math.max(1,Math.floor(l.advance/2)):1,bo:l?l.bo:3});
  openIdx=state.stages.length-1;render();};
renderTemplates();
render();
