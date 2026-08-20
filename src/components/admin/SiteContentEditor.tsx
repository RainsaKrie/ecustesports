"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent, type FormEvent, type ReactNode } from "react";
import type { EditableEvent, SiteConfig } from "@/lib/site-config-schema";
import { VALORANT_MAPS, mapImageOf } from "@/lib/maps";

const inputClass = "mt-2 h-11 w-full border border-slate-300 bg-white px-3 text-sm font-normal text-slate-900 outline-none transition focus:border-[#ff4655]";
const textareaClass = "mt-2 w-full border border-slate-300 bg-white px-3 py-3 text-sm font-normal leading-6 text-slate-900 outline-none transition focus:border-[#ff4655]";

function Section({ title, description, children, open = false }: { title: string; description: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="border border-slate-200 bg-white">
      <summary className="cursor-pointer list-none border-b border-slate-200 px-5 py-4">
        <div className="flex items-center justify-between gap-4">
          <div><h2 className="text-sm font-black text-slate-950">{title}</h2><p className="mt-1 text-xs font-normal text-slate-500">{description}</p></div>
          <span className="font-mono text-xs font-black text-[#ff4655]">＋</span>
        </div>
      </summary>
      <div className="p-5">{children}</div>
    </details>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return <label className="block text-xs font-bold text-slate-700">{label}{children}{hint && <span className="mt-1 block text-[0.625rem] font-normal leading-5 text-slate-400">{hint}</span>}</label>;
}

export default function SiteContentEditor({ initialConfig }: { initialConfig: SiteConfig }) {
  const router = useRouter();
  const [config, setConfig] = useState(initialConfig);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "error">("idle");
  const [message, setMessage] = useState("");
  const [newMapName, setNewMapName] = useState("");
  const currentEvent = config.events.find((e) => e.id === config.currentEventId) ?? config.events[0];

  const patchBrand = (patch: Partial<SiteConfig["brand"]>) => setConfig((current) => ({ ...current, brand: { ...current.brand, ...patch } }));
  const patchNavigation = (patch: Partial<SiteConfig["navigation"]>) => setConfig((current) => ({ ...current, navigation: { ...current.navigation, ...patch } }));
  const patchSeo = (patch: Partial<SiteConfig["seo"]>) => setConfig((current) => ({ ...current, seo: { ...current.seo, ...patch } }));
  const patchHome = (patch: Partial<SiteConfig["home"]>) => setConfig((current) => ({ ...current, home: { ...current.home, ...patch } }));
  const patchEventList = (patch: Partial<SiteConfig["eventList"]>) => setConfig((current) => ({ ...current, eventList: { ...current.eventList, ...patch } }));
  const patchEvent = (patch: Partial<EditableEvent>) => setConfig((current) => {
    const eventId = current.events.find((e) => e.id === current.currentEventId)?.id ?? current.events[0]?.id;
    if (!eventId) return current;
    return {
      ...current,
      events: current.events.map((e) => (e.id === eventId ? { ...e, ...patch } : e)),
    };
  });

  const updateCard = (index: number, patch: Partial<SiteConfig["home"]["cards"][number]>) => {
    const cards = config.home.cards.map((card, cardIndex) => cardIndex === index ? { ...card, ...patch } : card);
    patchHome({ cards });
  };

  const updateStep = (index: number, patch: Partial<EditableEvent["preparationSteps"][number]>) => {
    const preparationSteps = currentEvent.preparationSteps.map((step, stepIndex) => stepIndex === index ? { ...step, ...patch } : step);
    patchEvent({ preparationSteps });
  };

  const updateRule = (index: number, patch: Partial<EditableEvent["rules"][number]>) => {
    const rules = currentEvent.rules.map((rule, ruleIndex) => ruleIndex === index ? { ...rule, ...patch } : rule);
    patchEvent({ rules });
  };

  const updateArchive = (index: number, patch: Partial<SiteConfig["archives"][number]>) => {
    const archives = config.archives.map((archive, archiveIndex) => archiveIndex === index ? { ...archive, ...patch } : archive);
    setConfig((current) => ({ ...current, archives }));
  };

  const addMap = () => {
    const name = newMapName.trim();
    if (!name) return;
    if (currentEvent.mapPool.some((m) => m.name.toLowerCase() === name.toLowerCase())) return;
    patchEvent({ mapPool: [...currentEvent.mapPool, { id: name, name }] });
    setNewMapName("");
  };

  const catalogMaps = VALORANT_MAPS.filter((m) => !currentEvent.mapPool.some((x) => x.id === m.id));

  const handleSave = async (event: FormEvent) => {
    event.preventDefault();
    setSaveState("saving");
    setMessage("");
    try {
      const response = await fetch("/api/admin/site-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const result = await response.json() as { config?: SiteConfig; message?: string };
      if (!response.ok || !result.config) throw new Error(result.message ?? "保存失败");
      setConfig(result.config);
      setSaveState("saved");
      setMessage(result.message ?? "已保存并同步到前台。");
      router.refresh();
    } catch (error) {
      setSaveState("error");
      setMessage(error instanceof Error ? error.message : "保存失败，请稍后重试。");
    }
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>, apply: (path: string) => void) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploadState("uploading");
    setMessage("");
    const formData = new FormData();
    formData.append("file", file);
    try {
      const response = await fetch("/api/admin/upload", { method: "POST", body: formData });
      const result = await response.json() as { path?: string; message?: string };
      if (!response.ok || !result.path) throw new Error(result.message ?? "图片上传失败");
      apply(result.path);
      setUploadState("idle");
      setMessage("图片已上传。请点击“保存并同步前台”完成发布。");
    } catch (error) {
      setUploadState("error");
      setMessage(error instanceof Error ? error.message : "图片上传失败，请重试。");
    }
  };

  const handleHeroUpload = (event: ChangeEvent<HTMLInputElement>) => uploadImage(event, (path) => patchHome({ heroImage: path }));

  return (
    <form onSubmit={handleSave} className="space-y-5">
      <div className="sticky top-16 z-20 flex flex-wrap items-center justify-between gap-4 border border-slate-200 border-t-2 border-t-[#ff4655] bg-white px-5 py-4">
        <div>
          <p className="font-mono text-[0.5625rem] font-black tracking-[0.14em] text-[#c83242]">PUBLIC CONTENT / 公开内容</p>
          <p className="mt-1 text-sm font-black text-slate-950">后台保存后，首页和赛事页读取同一份配置</p>
          {message && <p className={`mt-1 text-xs ${saveState === "error" ? "text-red-600" : "text-emerald-600"}`}>{message}</p>}
        </div>
        <div className="flex gap-2">
          <Link href="/" target="_blank" className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">查看公开首页</Link>
          <button type="submit" disabled={saveState === "saving"} className="bg-[#ff4655] px-5 py-2.5 text-xs font-black text-white disabled:cursor-wait disabled:opacity-60">
            {saveState === "saving" ? "正在保存…" : "保存并同步前台"}
          </button>
        </div>
      </div>

      <div className="border border-blue-200 bg-blue-50 px-5 py-4 text-xs leading-6 text-blue-800">
        本页管理公开页面文案和本届赛事基础配置。报名队伍数、已完成场次、比分、晋级关系等业务数据由对应模块自动生成，不在这里重复填写。当前本地版本保存到项目数据文件；上线多人使用时再接入数据库和账号权限。
      </div>

      <Section title="本届赛事" description="赛事名称、状态、规模、赛制摘要和对外说明" open>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="赛事名称"><input value={currentEvent.name} onChange={(e) => patchEvent({ name: e.target.value })} className={inputClass} /></Field>
          <Field label="游戏"><input value={currentEvent.game} onChange={(e) => patchEvent({ game: e.target.value })} className={inputClass} /></Field>
          <Field label="赛事状态">
            <select value={currentEvent.status} onChange={(e) => patchEvent({ status: e.target.value as EditableEvent["status"] })} className={inputClass}>
              <option value="draft">筹备中</option><option value="registration">报名中</option><option value="ongoing">进行中</option><option value="completed">已结束</option><option value="archived">已归档</option>
            </select>
          </Field>
          <Field label="主办方"><input value={currentEvent.organizer} onChange={(e) => patchEvent({ organizer: e.target.value })} className={inputClass} /></Field>
          <Field label="目标队伍数"><input type="number" min="1" value={currentEvent.teamCount} onChange={(e) => patchEvent({ teamCount: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label="每队首发人数"><input type="number" min="1" value={currentEvent.teamSize} onChange={(e) => patchEvent({ teamSize: Number(e.target.value) })} className={inputClass} /></Field>
          <Field label="比赛时间展示"><input value={currentEvent.eventDateLabel} onChange={(e) => patchEvent({ eventDateLabel: e.target.value })} className={inputClass} /></Field>
          <Field label="报名状态展示"><input value={currentEvent.registrationLabel} onChange={(e) => patchEvent({ registrationLabel: e.target.value })} className={inputClass} /></Field>
          <Field label="报名开始日期" hint="在此之前报名页显示「未开放」"><input type="date" value={currentEvent.registrationStart} onChange={(e) => patchEvent({ registrationStart: e.target.value })} className={inputClass} /></Field>
          <Field label="报名截止日期" hint="在此之后报名页显示「已截止」"><input type="date" value={currentEvent.registrationEnd} onChange={(e) => patchEvent({ registrationEnd: e.target.value })} className={inputClass} /></Field>
          <Field label="赛制摘要" hint="用于首页卡片和赛事详情，如：32 队入围赛 → 16 队小组赛 → 8 队双败淘汰"><input value={currentEvent.stageSummary} onChange={(e) => patchEvent({ stageSummary: e.target.value })} className={inputClass} /></Field>
          <Field label="主题色" hint="输入六位十六进制颜色"><input type="color" value={currentEvent.coverColor} onChange={(e) => patchEvent({ coverColor: e.target.value })} className={`${inputClass} p-1`} /></Field>
          <Field label="赛事海报" hint="宣传海报竖图，作为赛事中心页底板；留空则用主题色渐变。支持 JPG、PNG、WebP，最大 5MB">
            <input value={currentEvent.posterImage} onChange={(e) => patchEvent({ posterImage: e.target.value })} className={inputClass} placeholder="/uploads/poster.jpg" />
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => uploadImage(e, (path) => patchEvent({ posterImage: path }))} className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:border-0 file:bg-[#ff4655] file:px-3 file:py-2 file:text-xs file:font-bold file:text-white" />
            {currentEvent.posterImage && <img src={currentEvent.posterImage} alt="赛事海报预览" className="mt-2 h-24 w-auto border border-slate-200 object-contain" />}
          </Field>
          <Field label="赛事简介"><textarea rows={4} value={currentEvent.description} onChange={(e) => patchEvent({ description: e.target.value })} className={textareaClass} /></Field>
          <Field label="奖项说明"><textarea rows={4} value={currentEvent.prizePool} onChange={(e) => patchEvent({ prizePool: e.target.value })} className={textareaClass} /></Field>
        </div>
      </Section>

      <Section title="地图池" description="BP 工具可用的地图，跟随排位图池维护，轮换替换由人工在此完成；BO5 需要至少 5 张">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {currentEvent.mapPool.map((map) => (
            <div key={map.id} className="group relative overflow-hidden border border-slate-200 bg-white">
              {mapImageOf(map) && (
                <img src={mapImageOf(map)} alt={map.name} className="h-16 w-full object-cover opacity-80" />
              )}
              <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                <span className="truncate text-xs font-bold text-slate-700">{map.name}</span>
                <button type="button" onClick={() => patchEvent({ mapPool: currentEvent.mapPool.filter((m) => m.id !== map.id) })} className="shrink-0 text-slate-400 hover:text-red-600">停用</button>
              </div>
            </div>
          ))}
        </div>
        {currentEvent.mapPool.length < 5 && (
          <p className="mt-3 text-xs font-bold text-red-600">
            当前仅 {currentEvent.mapPool.length} 张地图，BO5 需要至少 5 张；不足时 BO5 场次将无法开始 BP。
          </p>
        )}
        <div className="mt-4 flex gap-2">
          <input value={newMapName} onChange={(e) => setNewMapName(e.target.value)} placeholder="新地图名称（如 裂变峡谷）" className={inputClass} />
          <button type="button" onClick={addMap} className="shrink-0 border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">添加地图</button>
        </div>
        {catalogMaps.length > 0 && (
          <div className="mt-3">
            <p className="text-xs font-bold text-slate-500">候选地图（当前未启用，点击启用）</p>
            <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {catalogMaps.map((m) => (
                <button key={m.id} type="button" onClick={() => patchEvent({ mapPool: [...currentEvent.mapPool, { id: m.id, name: m.name }] })} className="group overflow-hidden border border-slate-200 bg-white text-left hover:border-slate-950">
                  {m.image && <img src={m.image} alt={m.name} className="h-16 w-full object-cover opacity-70 transition group-hover:opacity-100" />}
                  <span className="block truncate px-2 py-1.5 text-xs font-bold text-slate-600">＋ {m.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section title="首页主视觉" description="首页首屏图片、标题、介绍和按钮文字" open>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="主标题第一行"><input value={config.home.headlineTop} onChange={(e) => patchHome({ headlineTop: e.target.value })} className={inputClass} /></Field>
          <Field label="主标题第二行"><input value={config.home.headlineBottom} onChange={(e) => patchHome({ headlineBottom: e.target.value })} className={inputClass} /></Field>
          <Field label="主视觉上方短句"><input value={config.home.kicker} onChange={(e) => patchHome({ kicker: e.target.value })} className={inputClass} /></Field>
          <Field label="主按钮文字"><input value={config.home.primaryCta} onChange={(e) => patchHome({ primaryCta: e.target.value })} className={inputClass} /></Field>
          <Field label="次按钮文字"><input value={config.home.secondaryCta} onChange={(e) => patchHome({ secondaryCta: e.target.value })} className={inputClass} /></Field>
          <Field label="主视觉图片" hint="支持 JPG、PNG、WebP，最大 5MB；上传后还需保存配置">
            <input value={config.home.heroImage} onChange={(e) => patchHome({ heroImage: e.target.value })} className={inputClass} />
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleHeroUpload} className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:border-0 file:bg-[#ff4655] file:px-3 file:py-2 file:text-xs file:font-bold file:text-white" />
            {uploadState === "uploading" && <span className="mt-2 block text-[0.625rem] text-blue-600">图片上传中…</span>}
          </Field>
          <Field label="图片替代文字"><input value={config.home.heroImageAlt} onChange={(e) => patchHome({ heroImageAlt: e.target.value })} className={inputClass} /></Field>
          <Field label="右侧装饰文字"><div className="grid grid-cols-2 gap-2"><input value={config.home.railLeft} onChange={(e) => patchHome({ railLeft: e.target.value })} className={inputClass} /><input value={config.home.railRight} onChange={(e) => patchHome({ railRight: e.target.value })} className={inputClass} /></div></Field>
          <div className="md:col-span-2"><Field label="主视觉介绍"><textarea rows={3} value={config.home.description} onChange={(e) => patchHome({ description: e.target.value })} className={textareaClass} /></Field></div>
        </div>
      </Section>

      <Section title="首页栏目" description="首页第二屏、四张说明卡片、赛事历史区和底部号召">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="流程区英文短句"><input value={config.home.journeyKicker} onChange={(e) => patchHome({ journeyKicker: e.target.value })} className={inputClass} /></Field>
          <Field label="流程区标题"><div className="grid grid-cols-2 gap-2"><input value={config.home.journeyTitleTop} onChange={(e) => patchHome({ journeyTitleTop: e.target.value })} className={inputClass} /><input value={config.home.journeyTitleBottom} onChange={(e) => patchHome({ journeyTitleBottom: e.target.value })} className={inputClass} /></div></Field>
          <div className="md:col-span-2"><Field label="流程区说明"><textarea rows={2} value={config.home.journeyAside} onChange={(e) => patchHome({ journeyAside: e.target.value })} className={textareaClass} /></Field></div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {config.home.cards.map((card, index) => (
            <div key={index} className="border border-slate-200 bg-slate-50 p-4">
              <p className="text-xs font-black text-slate-900">说明卡片 {index + 1}</p>
              <div className="mt-3 grid gap-3 sm:grid-cols-[80px_1fr]">
                <input value={card.index} onChange={(e) => updateCard(index, { index: e.target.value })} aria-label={`卡片 ${index + 1} 编号`} className={inputClass} />
                <input value={card.meta} onChange={(e) => updateCard(index, { meta: e.target.value })} aria-label={`卡片 ${index + 1} 英文标签`} className={inputClass} />
              </div>
              <input value={card.title} onChange={(e) => updateCard(index, { title: e.target.value })} aria-label={`卡片 ${index + 1} 标题`} className={inputClass} />
              <textarea rows={3} value={card.description} onChange={(e) => updateCard(index, { description: e.target.value })} aria-label={`卡片 ${index + 1} 说明`} className={textareaClass} />
            </div>
          ))}
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <Field label="往届区英文短句"><input value={config.home.historyKicker} onChange={(e) => patchHome({ historyKicker: e.target.value })} className={inputClass} /></Field>
          <Field label="往届区标题"><input value={config.home.historyTitle} onChange={(e) => patchHome({ historyTitle: e.target.value })} className={inputClass} /></Field>
          <Field label="往届区链接文字"><input value={config.home.historyLink} onChange={(e) => patchHome({ historyLink: e.target.value })} className={inputClass} /></Field>
          <Field label="底部英文短句"><input value={config.home.closingKicker} onChange={(e) => patchHome({ closingKicker: e.target.value })} className={inputClass} /></Field>
          <Field label="底部标题"><input value={config.home.closingTitle} onChange={(e) => patchHome({ closingTitle: e.target.value })} className={inputClass} /></Field>
          <Field label="底部按钮文字"><input value={config.home.closingCta} onChange={(e) => patchHome({ closingCta: e.target.value })} className={inputClass} /></Field>
        </div>
      </Section>

      <Section title="参赛步骤与规则" description="赛事详情页中玩家会看到的准备事项和正式规则">
        <div className="grid gap-4 md:grid-cols-3">
          {currentEvent.preparationSteps.map((step, index) => (
            <div key={index} className="border border-slate-200 bg-slate-50 p-4">
              <input value={step.number} onChange={(e) => updateStep(index, { number: e.target.value })} aria-label={`步骤 ${index + 1} 编号`} className={inputClass} />
              <input value={step.title} onChange={(e) => updateStep(index, { title: e.target.value })} aria-label={`步骤 ${index + 1} 标题`} className={inputClass} />
              <textarea rows={4} value={step.detail} onChange={(e) => updateStep(index, { detail: e.target.value })} aria-label={`步骤 ${index + 1} 说明`} className={textareaClass} />
            </div>
          ))}
        </div>
        <div className="mt-5 space-y-3">
          {currentEvent.rules.map((rule, index) => (
            <div key={index} className="grid gap-3 border border-slate-200 p-4 md:grid-cols-[180px_1fr_auto]">
              <input value={rule.title} onChange={(e) => updateRule(index, { title: e.target.value })} aria-label={`规则 ${index + 1} 标题`} className={inputClass} />
              <textarea rows={2} value={rule.detail} onChange={(e) => updateRule(index, { detail: e.target.value })} aria-label={`规则 ${index + 1} 内容`} className={textareaClass} />
              <button type="button" onClick={() => patchEvent({ rules: currentEvent.rules.filter((_, ruleIndex) => ruleIndex !== index) })} className="self-end border border-red-200 px-3 py-2 text-xs font-bold text-red-600 hover:bg-red-50">删除</button>
            </div>
          ))}
          <button type="button" onClick={() => patchEvent({ rules: [...currentEvent.rules, { title: "新规则", detail: "待填写" }] })} className="border border-slate-300 px-4 py-2.5 text-xs font-bold text-slate-700 hover:border-slate-950">＋ 添加规则</button>
        </div>
      </Section>

      <Section title="站点品牌、导航与搜索信息" description="全站顶部、页脚、浏览器标题和搜索摘要">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="站点名称"><input value={config.brand.name} onChange={(e) => patchBrand({ name: e.target.value })} className={inputClass} /></Field>
          <Field label="英文名称"><input value={config.brand.englishName} onChange={(e) => patchBrand({ englishName: e.target.value })} className={inputClass} /></Field>
          <Field label="品牌缩写"><input value={config.brand.mark} onChange={(e) => patchBrand({ mark: e.target.value })} className={inputClass} /></Field>
          <Field label="页脚状态"><input value={config.brand.footerStatus} onChange={(e) => patchBrand({ footerStatus: e.target.value })} className={inputClass} /></Field>
          <Field label="页脚版权"><input value={config.brand.copyright} onChange={(e) => patchBrand({ copyright: e.target.value })} className={inputClass} /></Field>
          <Field label="浏览器标题"><input value={config.seo.title} onChange={(e) => patchSeo({ title: e.target.value })} className={inputClass} /></Field>
          <div className="md:col-span-2"><Field label="页脚说明"><textarea rows={2} value={config.brand.footerDescription} onChange={(e) => patchBrand({ footerDescription: e.target.value })} className={textareaClass} /></Field></div>
          <div className="md:col-span-2"><Field label="搜索摘要"><textarea rows={2} value={config.seo.description} onChange={(e) => patchSeo({ description: e.target.value })} className={textareaClass} /></Field></div>
          {(["home", "events", "bp", "admin"] as const).map((key) => (
            <Field key={key} label={`导航：${key}`}><input value={config.navigation[key]} onChange={(e) => patchNavigation({ [key]: e.target.value })} className={inputClass} /></Field>
          ))}
        </div>
      </Section>

      <Section title="赛事列表与往届说明" description="赛事中心页标题，以及已举办赛事的名称和资料状态">
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="赛事列表英文短句"><input value={config.eventList.eyebrow} onChange={(e) => patchEventList({ eyebrow: e.target.value })} className={inputClass} /></Field>
          <Field label="赛事列表标题"><input value={config.eventList.title} onChange={(e) => patchEventList({ title: e.target.value })} className={inputClass} /></Field>
          <div className="md:col-span-2"><Field label="赛事列表说明"><textarea rows={2} value={config.eventList.description} onChange={(e) => patchEventList({ description: e.target.value })} className={textareaClass} /></Field></div>
        </div>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {config.archives.length === 0 ? (
            <p className="md:col-span-2 text-sm text-slate-400">暂无往届赛事。本届结束后可在后台补录历届赛事资料。</p>
          ) : (
            config.archives.map((archive, index) => (
              <div key={archive.id} className="border border-slate-200 bg-slate-50 p-4">
                <p className="text-xs font-black text-slate-900">往届赛事 {index + 1}</p>
                <input value={archive.name} onChange={(e) => updateArchive(index, { name: e.target.value })} aria-label={`往届赛事 ${index + 1} 名称`} className={inputClass} />
                <input value={archive.game} onChange={(e) => updateArchive(index, { game: e.target.value })} aria-label={`往届赛事 ${index + 1} 游戏`} className={inputClass} />
                <textarea rows={3} value={archive.description} onChange={(e) => updateArchive(index, { description: e.target.value })} aria-label={`往届赛事 ${index + 1} 说明`} className={textareaClass} />
                <input type="color" value={archive.coverColor} onChange={(e) => updateArchive(index, { coverColor: e.target.value })} aria-label={`往届赛事 ${index + 1} 主题色`} className={`${inputClass} p-1`} />
                <input value={archive.posterImage} onChange={(e) => updateArchive(index, { posterImage: e.target.value })} aria-label={`往届赛事 ${index + 1} 海报`} placeholder="海报图片路径，可留空" className={inputClass} />
                <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => uploadImage(e, (path) => updateArchive(index, { posterImage: path }))} className="mt-2 block w-full text-xs text-slate-500 file:mr-3 file:border-0 file:bg-[#ff4655] file:px-3 file:py-2 file:text-xs file:font-bold file:text-white" />
                {archive.posterImage && <img src={archive.posterImage} alt={`往届赛事 ${index + 1} 海报预览`} className="mt-2 h-24 w-auto border border-slate-200 object-contain" />}
              </div>
            ))
          )}
        </div>
      </Section>

      <div className="flex flex-wrap items-center justify-between gap-4 border border-slate-200 bg-white px-5 py-4">
        <p className="text-xs text-slate-500">最后保存：{new Date(config.updatedAt).toLocaleString("zh-CN")}</p>
        <button type="submit" disabled={saveState === "saving"} className="bg-[#ff4655] px-6 py-3 text-xs font-black text-white disabled:opacity-60">{saveState === "saving" ? "正在保存…" : "保存全部修改"}</button>
      </div>
    </form>
  );
}
