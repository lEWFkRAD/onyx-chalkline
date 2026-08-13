"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { chalklinePlugins, getPlugin } from "../lib/plugins/registry";
import { parseCsv, toCsv } from "../lib/plugins/csv";

type View = "today" | "plan" | "evidence" | "students" | "integrations";
type MisconceptionKey = "denominator" | "visual" | "secure";

type EvidenceNote = {
  id: number;
  student: string;
  note: string;
  time: string;
};

const navItems: Array<{ id: View; label: string; icon: string }> = [
  { id: "today", label: "Today", icon: "⌂" },
  { id: "plan", label: "Plan", icon: "▤" },
  { id: "evidence", label: "Evidence", icon: "◎" },
  { id: "students", label: "Students", icon: "◌" },
  { id: "integrations", label: "Integrations", icon: "↔" },
];

const groups = [
  {
    id: "denominator" as const,
    label: "Denominator meaning",
    count: 5,
    tone: "coral",
    students: "Maya, Eli, Noah +2",
    signal: "Names parts correctly but treats larger denominators as larger pieces.",
    evidence: "Exit tickets 04, 07, 09, 12, 16",
  },
  {
    id: "visual" as const,
    label: "Model → notation",
    count: 4,
    tone: "gold",
    students: "Luis, Harper, Jada +1",
    signal: "Builds the model correctly; reverses numerator and denominator in notation.",
    evidence: "Exit tickets 02, 06, 11, 15",
  },
  {
    id: "secure" as const,
    label: "Ready to extend",
    count: 9,
    tone: "sage",
    students: "Ava, Caleb, Sofia +6",
    signal: "Compares unit fractions correctly and explains using equal-size parts.",
    evidence: "Exit tickets 01, 03, 05, 08, 10, 13, 14, 17, 18",
  },
];

const students = [
  { initials: "MB", name: "Maya B.", signal: "Needs a concrete model before notation", level: "Developing", trend: "→" },
  { initials: "ER", name: "Eli R.", signal: "Confuses piece size and piece count", level: "Developing", trend: "↗" },
  { initials: "LS", name: "Luis S.", signal: "Correct model; notation reversal", level: "Approaching", trend: "↗" },
  { initials: "AH", name: "Ava H.", signal: "Explains comparison with precision", level: "Secure", trend: "↗" },
  { initials: "CJ", name: "Caleb J.", signal: "Ready for non-unit fractions", level: "Secure", trend: "→" },
  { initials: "SN", name: "Sofia N.", signal: "Uses benchmarks independently", level: "Secure", trend: "↗" },
];

function DownloadButton({ children, onClick, subtle = false }: { children: React.ReactNode; onClick: () => void; subtle?: boolean }) {
  return (
    <button className={subtle ? "button button-subtle" : "button button-dark"} onClick={onClick} type="button">
      {children}
    </button>
  );
}

export function ChalklineApp() {
  const [view, setView] = useState<View>("today");
  const [selectedGroup, setSelectedGroup] = useState<MisconceptionKey>("denominator");
  const [notes, setNotes] = useState<EvidenceNote[]>([]);
  const [noteText, setNoteText] = useState("");
  const [noteStudent, setNoteStudent] = useState("Whole class");
  const [activePluginId, setActivePluginId] = useState<string | null>(null);
  const [toast, setToast] = useState("");
  const [rosterCount, setRosterCount] = useState(24);
  const [rosterFile, setRosterFile] = useState("Sample roster · 24 students");
  const [planBuilt, setPlanBuilt] = useState(false);
  const [checkedSteps, setCheckedSteps] = useState<number[]>([0]);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const saved = window.localStorage.getItem("chalkline-evidence-notes");
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        const timeout = window.setTimeout(() => setNotes(parsed), 0);
        return () => window.clearTimeout(timeout);
      } catch {
        window.localStorage.removeItem("chalkline-evidence-notes");
      }
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("chalkline-evidence-notes", JSON.stringify(notes));
  }, [notes]);

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  const selected = useMemo(() => groups.find((group) => group.id === selectedGroup) ?? groups[0], [selectedGroup]);
  const activePlugin = activePluginId ? getPlugin(activePluginId) : undefined;

  function showToast(message: string) {
    setToast(message);
  }

  function download(filename: string, content: string, type = "text/csv") {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast(`${filename} is ready.`);
  }

  function exportEvidence() {
    const rows = groups.flatMap((group) =>
      group.students.split(", ").map((student, index) => ({
        student: student.includes("+") ? `Additional student group ${index + 1}` : student,
        standard: "3.NF.A.1",
        evidence_source: group.evidence,
        learning_signal: group.label,
        teacher_status: group.id === "secure" ? "secure" : "review",
        recommended_next_step: group.signal,
      })),
    );
    download("chalkline-evidence-3nf-a1.csv", toCsv(Object.keys(rows[0]), rows));
  }

  function exportLesson() {
    const lesson = {
      title: "Fractions are equal parts — responsive lesson",
      standard: "3.NF.A.1",
      objective: "Explain a unit fraction as one equal part of a whole and connect a model to notation.",
      sourceEvidence: groups.map(({ label, count, evidence }) => ({ label, count, evidence })),
      groups: [
        { name: "Rebuild", students: 5, activity: "Paper strip fold-and-compare conference" },
        { name: "Connect", students: 4, activity: "Model-to-symbol matching routine" },
        { name: "Extend", students: 9, activity: "Compare non-unit fractions and justify" },
      ],
      releaseState: "teacher_reviewed",
    };
    download("chalkline-canvas-assignment.json", JSON.stringify(lesson, null, 2), "application/json");
  }

  async function importRoster(file: File) {
    const text = await file.text();
    const rows = parseCsv(text);
    if (!rows.length) {
      showToast("That file needs a header row and at least one student row.");
      return;
    }
    setRosterCount(rows.length);
    setRosterFile(`${file.name} · ${rows.length} students`);
    showToast(`${rows.length} roster records mapped locally. No upload occurred.`);
  }

  function addEvidenceNote() {
    if (!noteText.trim()) {
      showToast("Add a short observation first.");
      return;
    }
    setNotes((current) => [
      { id: Date.now(), student: noteStudent, note: noteText.trim(), time: "Just now" },
      ...current,
    ]);
    setNoteText("");
    showToast("Evidence note saved on this device.");
  }

  function buildPlan() {
    setPlanBuilt(true);
    setView("plan");
    showToast("Tomorrow's draft is ready for your review.");
  }

  function toggleStep(index: number) {
    setCheckedSteps((current) => current.includes(index) ? current.filter((item) => item !== index) : [...current, index]);
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <button className="brand" onClick={() => setView("today")} type="button" aria-label="Chalkline home">
          <span className="brand-mark"><i /><i /><i /></span>
          <span>Chalkline</span>
        </button>
        <nav className="nav-list">
          {navItems.map((item) => (
            <button
              className={view === item.id ? "nav-item active" : "nav-item"}
              key={item.id}
              onClick={() => setView(item.id)}
              type="button"
            >
              <span className="nav-icon" aria-hidden="true">{item.icon}</span>
              <span>{item.label}</span>
              {item.id === "evidence" && <span className="nav-badge">18</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-spacer" />
        <button className="class-switcher" type="button" onClick={() => showToast("Class switcher is ready for roster-connected courses.") }>
          <span className="class-dot">3</span>
          <span><strong>Math · Period 2</strong><small>24 students</small></span>
          <span aria-hidden="true">⌄</span>
        </button>
        <div className="teacher-card">
          <span className="avatar">JW</span>
          <span><strong>Jamie Walker</strong><small>Teacher workspace</small></span>
          <button type="button" aria-label="Teacher settings" onClick={() => showToast("Profile settings are coming in the district identity phase.")}>•••</button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">Thursday · August 13</span>
            <h1>{view === "today" ? "Good morning, Jamie." : navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="top-actions">
            <span className="privacy-pill"><i /> Local prototype · synthetic data</span>
            <button className="icon-button" aria-label="Notifications" type="button" onClick={() => showToast("You’re all caught up.")}>◔</button>
          </div>
        </header>

        {view === "today" && (
          <div className="content today-view">
            <section className="teaching-brief">
              <div className="brief-copy">
                <span className="section-label light">Your teaching brief</span>
                <h2>Yesterday left you<br />a clear next move.</h2>
                <p>Nine students are ready to extend. Nine need one of two focused fraction routines before the class moves on.</p>
                <div className="brief-actions">
                  <button className="button button-cream" onClick={buildPlan} type="button">Build tomorrow’s lesson <span>→</span></button>
                  <button className="text-button light" onClick={() => setView("evidence")} type="button">Review all 18 tickets</button>
                </div>
              </div>
              <div className="brief-visual" aria-label="Three evidence-backed student groups">
                <div className="chalk-orbit orbit-one" />
                <div className="chalk-orbit orbit-two" />
                <div className="orbit-label center"><strong>18</strong><span>exit tickets</span></div>
                <button className="orbit-label label-one" type="button" onClick={() => { setSelectedGroup("denominator"); setView("evidence"); }}><strong>5</strong><span>rebuild</span></button>
                <button className="orbit-label label-two" type="button" onClick={() => { setSelectedGroup("visual"); setView("evidence"); }}><strong>4</strong><span>connect</span></button>
                <button className="orbit-label label-three" type="button" onClick={() => { setSelectedGroup("secure"); setView("evidence"); }}><strong>9</strong><span>extend</span></button>
              </div>
            </section>

            <div className="today-grid">
              <section className="panel evidence-preview">
                <div className="panel-heading">
                  <div><span className="section-label">Evidence signals</span><h3>What the work is saying</h3></div>
                  <button className="text-button" type="button" onClick={() => setView("evidence")}>See evidence →</button>
                </div>
                <div className="signal-list">
                  {groups.map((group) => (
                    <button className="signal-row" key={group.id} type="button" onClick={() => { setSelectedGroup(group.id); setView("evidence"); }}>
                      <span className={`signal-count ${group.tone}`}>{group.count}</span>
                      <span className="signal-copy"><strong>{group.label}</strong><small>{group.signal}</small></span>
                      <span className="signal-arrow">↗</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="panel next-up">
                <div className="panel-heading">
                  <div><span className="section-label">Next up</span><h3>Today’s teaching rhythm</h3></div>
                  <span className="time-chip">8:45–9:35</span>
                </div>
                {[
                  ["8:45", "Launch", "Notice & wonder: equal pieces"],
                  ["8:53", "Model", "Paper strips and unit fractions"],
                  ["9:08", "Practice", "Three evidence-based groups"],
                  ["9:29", "Check", "Two-question exit ticket"],
                ].map((step, index) => (
                  <button className={checkedSteps.includes(index) ? "timeline-row complete" : "timeline-row"} key={step[0]} onClick={() => toggleStep(index)} type="button">
                    <span className="check-ring">{checkedSteps.includes(index) ? "✓" : ""}</span>
                    <span className="timeline-time">{step[0]}</span>
                    <span><strong>{step[1]}</strong><small>{step[2]}</small></span>
                  </button>
                ))}
              </section>
            </div>

            <section className="capture-bar">
              <span className="capture-icon">＋</span>
              <div><strong>Capture something you noticed</strong><small>Attach a quick observation to the class evidence trail.</small></div>
              <select value={noteStudent} onChange={(event) => setNoteStudent(event.target.value)} aria-label="Student for evidence note">
                <option>Whole class</option>
                {students.map((student) => <option key={student.name}>{student.name}</option>)}
              </select>
              <input value={noteText} onChange={(event) => setNoteText(event.target.value)} placeholder="e.g. Eli explained the model aloud…" aria-label="Evidence note" onKeyDown={(event) => { if (event.key === "Enter") addEvidenceNote(); }} />
              <button className="button button-dark" onClick={addEvidenceNote} type="button">Save evidence</button>
            </section>
          </div>
        )}

        {view === "plan" && (
          <div className="content split-view">
            <section className="plan-document panel">
              <div className="document-header">
                <div><span className="section-label">Responsive lesson · Draft</span><h2>Fractions are equal parts</h2><p>Grade 3 Math · 3.NF.A.1 · 50 minutes</p></div>
                <span className={planBuilt ? "status-chip ready" : "status-chip"}>{planBuilt ? "Built from 18 tickets" : "Teacher draft"}</span>
              </div>
              <div className="lesson-objective">
                <span>Learning intention</span>
                <p>We can explain a unit fraction as one equal part of a whole and connect a visual model to fraction notation.</p>
              </div>
              <div className="lesson-blocks">
                <article><span className="block-time">8 min</span><div><strong>Launch · Which piece is larger?</strong><p>Show two same-size paper strips partitioned into thirds and sixths. Collect reasoning before revealing notation.</p><small>Responds to denominator-size misconception · tickets 04, 07, 09, 12, 16</small></div></article>
                <article><span className="block-time">12 min</span><div><strong>Model · Say it, build it, write it</strong><p>Students fold, shade, verbally name, and then write each unit fraction in that order.</p><small>Responds to model-to-notation reversal · tickets 02, 06, 11, 15</small></div></article>
                <article><span className="block-time">22 min</span><div><strong>Three pathways</strong><div className="pathway-grid"><span><b>Rebuild · 5</b>Teacher table with paper strips</span><span><b>Connect · 4</b>Model-symbol matching cards</span><span><b>Extend · 9</b>Compare non-unit fractions</span></div></div></article>
                <article><span className="block-time">8 min</span><div><strong>Check · Explain, don’t guess</strong><p>Draw 1/4, compare it with 1/6, and explain how the denominator changes piece size.</p><small>New evidence returns to Chalkline before any next-step recommendation.</small></div></article>
              </div>
            </section>
            <aside className="review-rail">
              <section className="panel review-card">
                <span className="section-label">Teacher release</span><h3>You stay in control.</h3><p>Chalkline can prepare the handoff. Nothing becomes an assignment or grade until you review and release it.</p>
                <label className="review-check"><input type="checkbox" defaultChecked /> Sources match the student work</label>
                <label className="review-check"><input type="checkbox" defaultChecked /> Groups are temporary, not labels</label>
                <label className="review-check"><input type="checkbox" /> Materials are ready to publish</label>
              </section>
              <section className="panel publish-card">
                <span className="section-label">Handoff</span>
                <button type="button" onClick={() => setActivePluginId("canvas")}><span className="plugin-mini canvas">C</span><span><strong>Canvas assignment</strong><small>District setup or JSON package</small></span><b>→</b></button>
                <button type="button" onClick={() => setActivePluginId("infinite-campus")}><span className="plugin-mini campus">IC</span><span><strong>Campus evidence export</strong><small>CSV preview before download</small></span><b>→</b></button>
                <DownloadButton onClick={exportLesson}>Download teacher package</DownloadButton>
              </section>
            </aside>
          </div>
        )}

        {view === "evidence" && (
          <div className="content evidence-view">
            <div className="evidence-layout">
              <section className="panel group-list-panel">
                <div className="panel-heading"><div><span className="section-label">18 analyzed</span><h3>Evidence groups</h3></div><button className="icon-button small" type="button" onClick={exportEvidence} aria-label="Export evidence">↓</button></div>
                <p className="panel-intro">Groups describe today’s evidence—not the student.</p>
                {groups.map((group) => (
                  <button className={selectedGroup === group.id ? "group-choice active" : "group-choice"} type="button" key={group.id} onClick={() => setSelectedGroup(group.id)}>
                    <span className={`signal-count ${group.tone}`}>{group.count}</span>
                    <span><strong>{group.label}</strong><small>{group.students}</small></span>
                    <b>›</b>
                  </button>
                ))}
                <div className="evidence-guardrail"><span>◉</span><p><strong>Evidence boundary</strong>Chalkline never turns a temporary pattern into a permanent student label.</p></div>
              </section>
              <section className="panel evidence-detail">
                <div className="detail-header"><div><span className="section-label">Selected signal</span><h2>{selected.label}</h2><p>{selected.count} students · Standard 3.NF.A.1</p></div><span className="confidence"><i /> Strong signal</span></div>
                <div className="claim-card"><span>Chalkline’s reading</span><blockquote>“{selected.signal}”</blockquote><p>This is a draft interpretation for teacher review, supported by {selected.evidence.toLowerCase()}.</p></div>
                <div className="source-strip"><span className="paper-stack">▱</span><div><strong>{selected.evidence}</strong><small>Source-linked · collected August 12 · teacher release pending</small></div><button type="button" onClick={() => showToast("Source viewer will open scanned work after a district-approved storage connection.")}>View sources</button></div>
                <div className="student-samples">
                  <div className="sample-row"><span className="avatar warm">MB</span><div><strong>“1/8 is bigger because 8 is bigger than 4.”</strong><small>Written response · ticket 04</small></div><span className="tag">Direct evidence</span></div>
                  <div className="sample-row"><span className="avatar cool">ER</span><div><strong>Correctly shades 1/6, then points to 1/3 as the smaller piece.</strong><small>Model + teacher observation · ticket 07</small></div><span className="tag">Corroborated</span></div>
                </div>
                <div className="next-move"><div><span className="section-label">Suggested next move</span><h3>{selected.id === "secure" ? "Extend the reasoning" : "Make piece size visible"}</h3><p>{selected.id === "secure" ? "Move from unit fractions to comparing non-unit fractions with common numerators." : "Use same-size paper strips. Ask students to predict, fold, compare, and explain before introducing symbols."}</p></div><button className="button button-dark" type="button" onClick={buildPlan}>Add to tomorrow’s plan</button></div>
              </section>
            </div>
            {notes.length > 0 && <section className="panel recent-notes"><div className="panel-heading"><div><span className="section-label">Teacher observations</span><h3>Recent notes</h3></div></div>{notes.slice(0, 4).map((note) => <article key={note.id}><span className="avatar tiny">{note.student === "Whole class" ? "ALL" : note.student.split(" ").map((part) => part[0]).join("")}</span><div><strong>{note.student}</strong><p>{note.note}</p></div><small>{note.time}</small></article>)}</section>}
          </div>
        )}

        {view === "students" && (
          <div className="content students-view">
            <section className="student-hero panel"><div><span className="section-label">Class evidence picture</span><h2>See the learner.<br />Not a label.</h2><p>Every signal is time-bound, source-linked, and open to teacher correction.</p></div><div className="class-metric"><strong>75%</strong><span>showed growth across<br />the last three checks</span></div></section>
            <section className="panel student-table">
              <div className="panel-heading"><div><span className="section-label">Math · Period 2</span><h3>{rosterCount} students</h3></div><button className="button button-subtle" type="button" onClick={() => fileInput.current?.click()}>Import roster CSV</button></div>
              <input ref={fileInput} className="hidden-input" type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importRoster(file); }} />
              <div className="roster-source"><span>↔</span><div><strong>{rosterFile}</strong><small>Portable roster handoff · stays on this device</small></div><span className="status-chip ready">Mapped</span></div>
              <div className="table-head"><span>Student</span><span>Current evidence signal</span><span>Teacher status</span><span>Trend</span></div>
              {students.map((student) => <button className="student-row" type="button" key={student.name} onClick={() => showToast(`${student.name}'s source-linked view is ready for the next student profile increment.`)}><span><i className="avatar">{student.initials}</i><strong>{student.name}</strong></span><span>{student.signal}</span><span className={`level ${student.level.toLowerCase()}`}>{student.level}</span><b>{student.trend}</b></button>)}
            </section>
          </div>
        )}

        {view === "integrations" && (
          <div className="content integrations-view">
            <section className="integration-hero"><span className="section-label">NWGA starter pack</span><h2>Meet teachers where<br />their work already lives.</h2><p>Chalkline adds an evidence loop around the region’s existing LMS, SIS, roster, and sign-on tools. It does not ask a district to replace them.</p><div><span><b>5</b> adapters</span><span><b>0</b> silent writes</span><span><b>1</b> teacher release gate</span></div></section>
            <section className="plugin-grid">
              {chalklinePlugins.map((plugin) => (
                <button className="plugin-card" type="button" key={plugin.id} onClick={() => setActivePluginId(plugin.id)}>
                  <span className="plugin-mark" style={{ backgroundColor: plugin.color }}>{plugin.mark}</span>
                  <span className="plugin-card-copy"><small>{plugin.category}</small><strong>{plugin.name}</strong><p>{plugin.description}</p></span>
                  <span className={`plugin-status ${plugin.status}`}>{plugin.status === "ready" ? "Ready now" : plugin.status === "file_handoff" ? "File handoff" : "District setup"}</span>
                  <b className="plugin-arrow">↗</b>
                </button>
              ))}
            </section>
            <section className="panel integration-principle"><span className="principle-number">01</span><div><span className="section-label">Integration principle</span><h3>Read broadly. Write narrowly. Release deliberately.</h3><p>Rosters and course context can inform the workspace. Assignments, grades, and family-facing records always pass through a visible teacher review.</p></div><button className="button button-dark" type="button" onClick={() => setActivePluginId("oneroster-csv")}>Try roster import</button></section>
          </div>
        )}
      </section>

      {activePlugin && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setActivePluginId(null); }}>
          <div className="plugin-drawer" role="dialog" aria-modal="true" aria-label={`${activePlugin.name} integration`}>
            <button className="drawer-close" type="button" aria-label="Close integration details" onClick={() => setActivePluginId(null)}>×</button>
            <span className="plugin-mark large" style={{ backgroundColor: activePlugin.color }}>{activePlugin.mark}</span>
            <span className="section-label">{activePlugin.category} plugin</span>
            <h2>{activePlugin.name}</h2>
            <p className="drawer-description">{activePlugin.description}</p>
            <p className="connector-note"><i>✓</i>{activePlugin.status === "ready" ? "Local adapter active in this build." : "Executable connector included and contract-tested; live exchange activates only after district authorization."}</p>
            <div className="region-proof"><span>NWGA</span><p><strong>Regional fit</strong>{activePlugin.regionNote}</p></div>
            <div className="capability-list"><span className="section-label">Plugin capabilities</span>{activePlugin.capabilities.map((capability) => <div key={capability}><i>✓</i>{capability.replace(".", " · ")}</div>)}</div>
            <div className="setup-box"><span>Setup needed</span><p>{activePlugin.setup}</p><small>Portable path: {activePlugin.fallback}</small></div>
            {activePlugin.id === "oneroster-csv" || activePlugin.id === "infinite-campus" ? (
              <><button className="button button-dark full" type="button" onClick={() => { setActivePluginId(null); setView("students"); window.setTimeout(() => fileInput.current?.click(), 80); }}>Import roster CSV</button><button className="button button-subtle full" type="button" onClick={exportEvidence}>Export evidence CSV</button></>
            ) : (
              <><button className="button button-dark full" type="button" onClick={() => showToast("District setup checklist prepared; live authorization requires the district administrator.")}>Prepare district setup</button>{activePlugin.id === "canvas" && <button className="button button-subtle full" type="button" onClick={exportLesson}>Use portable package</button>}</>
            )}
            <p className="drawer-footnote">This prototype uses synthetic data and does not claim a live district connection.</p>
          </div>
        </div>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </main>
  );
}
