import React, { useState, useEffect, useRef } from 'react';
import { 
  Shield, 
  MapPin, 
  AlertTriangle, 
  CheckCircle2, 
  Camera, 
  List, 
  Plus, 
  LogOut, 
  Loader2,
  Trash2,
  History,
  FileText
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  serverTimestamp,
  deleteDoc,
  doc,
  orderBy
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { analyzeEnvironmentalSite, AuditResult } from './services/geminiService';
import ReactMarkdown from 'react-markdown';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<any[]>([]);
  const [activeSite, setActiveSite] = useState<any | null>(null);
  const [audits, setAudits] = useState<any[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AuditResult | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [lastUploadedImage, setLastUploadedImage] = useState<string | null>(null);
  const [showAddSite, setShowAddSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteLocation, setNewSiteLocation] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'sites'), where('ownerId', '==', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setSites(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return unsubscribe;
  }, [user]);

  useEffect(() => {
    if (!activeSite) {
      setAudits([]);
      return;
    }
    const q = query(
      collection(db, `sites/${activeSite.id}/audits`), 
      orderBy('createdAt', 'desc')
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setAudits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });
    return unsubscribe;
  }, [activeSite]);

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleLogout = () => signOut(auth);

  const handleAddSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    await addDoc(collection(db, 'sites'), {
      name: newSiteName,
      location: newSiteLocation,
      ownerId: user.uid,
      createdAt: serverTimestamp(),
      healthScore: 100
    });
    setNewSiteName('');
    setNewSiteLocation('');
    setShowAddSite(false);
  };

  const handleDeleteSite = async (id: string) => {
    if (confirm('Are you sure you want to delete this site and all its history?')) {
      await deleteDoc(doc(db, 'sites', id));
      if (activeSite?.id === id) setActiveSite(null);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !activeSite || !user) return;

    setAnalyzing(true);
    setAnalysisResult(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setLastUploadedImage(base64);
      try {
        const result = await analyzeEnvironmentalSite(base64, file.type);
        setAnalysisResult(result);

        // Save Audit
        await addDoc(collection(db, `sites/${activeSite.id}/audits`), {
          siteId: activeSite.id,
          auditorId: user.uid,
          imageUrl: base64, // In a real app we'd use Firebase Storage
          threatLevel: result.threat_level,
          findings: result.detailed_analysis,
          isoCompliance: result.iso_compliance_status.toLowerCase().includes('yes') || result.iso_compliance_status.toLowerCase().includes('compliant'),
          structuredData: result,
          createdAt: serverTimestamp()
        });
      } catch (err) {
        console.error(err);
        alert('Analysis failed. Check console for details.');
      } finally {
        setAnalyzing(false);
      }
    };
    reader.readAsDataURL(file);
  };

  if (loading) return (
    <div className="h-screen w-full flex items-center justify-center bg-[#0d1117]">
      <Loader2 className="animate-spin text-emerald-500" size={40} />
    </div>
  );

  if (!user) return (
    <div className="h-screen w-full flex flex-col items-center justify-center bg-[#0d1117] p-6 text-[#c9d1d9]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="max-w-md w-full text-center space-y-8"
      >
        <div className="flex justify-center">
          <div className="w-20 h-20 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20">
            <Shield size={40} />
          </div>
        </div>
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white font-sans">EcoSentinel</h1>
          <p className="mt-2 text-[#8b949e] font-sans text-lg">Autonomous Multimodal Environmental Auditor</p>
        </div>
        <button 
          onClick={handleLogin}
          className="w-full py-4 bg-[#238636] text-white font-sans font-bold rounded-md hover:bg-[#2eaa42] transition-all duration-300 shadow-lg shadow-emerald-900/20"
        >
          Initialize Agent Access
        </button>
      </motion.div>
    </div>
  );

  return (
    <div className="h-screen flex bg-[#0d1117] text-[#c9d1d9] font-sans selection:bg-emerald-500/30">
      {/* Sidebar - Site Navigation */}
      <aside className="w-64 bg-[#161b22] border-r border-[#30363d] flex flex-col overflow-hidden">
        <div className="p-6 border-b border-[#30363d]">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-8 h-8 bg-emerald-500 rounded-md flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <span className="font-bold text-white text-lg tracking-tight">EcoSentinel</span>
          </div>
          <button 
            onClick={() => setShowAddSite(true)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#21262d] border border-[#30363d] text-xs font-bold text-white rounded-md hover:border-[#8b949e] transition-colors"
          >
            <Plus size={14} /> New Site Entry
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
          <div className="text-[#8b949e] px-2 py-2 uppercase text-[10px] font-bold tracking-wider">Mission Control</div>
          <div className="space-y-1">
            {sites.map(site => (
              <div 
                key={site.id}
                onClick={() => setActiveSite(site)}
                className={`group flex items-center justify-between p-2.5 cursor-pointer rounded-md transition-all ${activeSite?.id === site.id ? 'bg-[#21262d] text-white' : 'text-[#c9d1d9] hover:bg-[#21262d]'}`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <MapPin size={16} className={activeSite?.id === site.id ? 'text-emerald-400' : 'text-[#8b949e]'} />
                  <span className="truncate text-sm">{site.name}</span>
                </div>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteSite(site.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity"
                >
                  <Trash2 size={12} />
                </button>
              </div>
            ))}
            {sites.length === 0 && (
              <p className="px-2 py-4 text-[11px] text-[#8b949e] italic">No active nodes...</p>
            )}
          </div>
        </nav>

        <div className="p-4 bg-[#0d1117] border-t border-[#30363d]">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-3 overflow-hidden">
              <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-md border border-[#30363d]" />
              <div className="overflow-hidden">
                <p className="text-[11px] font-bold text-white truncate">{user.displayName || user.email}</p>
                <p className="text-[9px] text-[#8b949e] uppercase tracking-tighter">Verified Auditor</p>
              </div>
            </div>
            <button onClick={handleLogout} className="p-2 text-[#8b949e] hover:text-white transition-colors">
              <LogOut size={16} />
            </button>
          </div>
          <div className="flex items-center justify-between text-[10px]">
            <span className="text-[#8b949e]">Memory Node:</span>
            <span className="text-blue-400">Backboard-V2</span>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <AnimatePresence>
          {showAddSite && (
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-[#0d1117]/80 backdrop-blur-sm flex items-center justify-center p-6"
            >
              <form onSubmit={handleAddSite} className="max-w-md w-full border border-[#30363d] rounded-xl p-8 space-y-6 bg-[#161b22] shadow-2xl">
                <h2 className="text-xl font-bold text-white tracking-tight">Register Environmental Node</h2>
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-bold text-[#8b949e] uppercase mb-1.5 tracking-wider">Site Identifier</label>
                    <input 
                      required
                      value={newSiteName}
                      onChange={e => setNewSiteName(e.target.value)}
                      placeholder="e.g., Sector 7G / Amazon Basin"
                      className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-md outline-none text-sm focus:border-emerald-500/50 text-white transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-[#8b949e] uppercase mb-1.5 tracking-wider">Geographic Coordinates</label>
                    <input 
                      required
                      value={newSiteLocation}
                      onChange={e => setNewSiteLocation(e.target.value)}
                      placeholder="e.g., 45.523062, -122.676482"
                      className="w-full p-2.5 bg-[#0d1117] border border-[#30363d] rounded-md outline-none text-sm focus:border-emerald-500/50 text-white transition-colors"
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-4">
                  <button 
                    type="button"
                    onClick={() => setShowAddSite(false)}
                    className="flex-1 py-2.5 bg-[#21262d] border border-[#30363d] text-white text-xs font-bold rounded-md hover:bg-[#30363d] transition-colors"
                  >
                    Cancel
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 py-2.5 bg-[#238636] text-white text-xs font-bold rounded-md hover:bg-[#2eaa42] transition-colors"
                  >
                    Confirm Entry
                  </button>
                </div>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        {activeSite ? (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Site Header */}
            <header className="h-16 border-b border-[#30363d] flex items-center justify-between px-8 bg-[#161b22]">
              <div>
                <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                  Site Audit: <span className="text-emerald-400">{activeSite.name}</span>
                </h2>
                <p className="text-[10px] text-[#8b949e] tracking-wider flex items-center gap-1.5">
                  <MapPin size={10} /> {activeSite.location}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <div className="flex items-center gap-2 px-3 py-1 bg-[#21262d] border border-[#30363d] rounded-full">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-[10px] text-[#8b949e] font-bold">GEMINI 1.5 FLASH</span>
                </div>
                <div>
                  <input 
                    type="file" 
                    accept="image/*" 
                    className="hidden" 
                    ref={fileInputRef}
                    onChange={handleFileUpload}
                  />
                  <button 
                    onClick={() => fileInputRef.current?.click()}
                    disabled={analyzing}
                    className="px-4 py-1.5 bg-[#238636] text-white text-xs font-bold rounded-full flex items-center gap-2 hover:bg-[#2eaa42] transition-all disabled:opacity-50"
                  >
                    {analyzing ? <Loader2 className="animate-spin" size={14} /> : <Camera size={14} />} 
                    {analyzing ? 'ANALYZING...' : 'SECURE AUDIT'}
                  </button>
                </div>
              </div>
            </header>

            {/* Analysis Grid */}
            <div className="flex-1 overflow-y-auto p-8 custom-scrollbar text-[#c9d1d9]">
              <div className="grid grid-cols-12 gap-8 max-w-7xl mx-auto h-full">
                {/* Left Section: Source & Logic */}
                <section className="col-span-12 lg:col-span-7 flex flex-col space-y-6">
                  {/* Artifact View */}
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden flex flex-col shadow-xl">
                    <div className="p-4 border-b border-[#30363d] flex items-center justify-between">
                      <span className="text-[10px] font-bold tracking-widest text-[#8b949e] uppercase">Primary Visual Source</span>
                      <span className="text-[9px] text-[#8b949e]">LATENCY: {analyzing ? '...' : (analysisResult ? '842ms' : '0ms')}</span>
                    </div>
                    <div className="relative aspect-video bg-black flex items-center justify-center p-8 group">
                      {lastUploadedImage || audits[0] ? (
                        <div className="w-full h-full relative">
                           <img 
                            src={lastUploadedImage || audits[0]?.imageUrl} 
                            alt="Site Scan" 
                            className={`w-full h-full object-cover rounded-lg border border-[#30363d] transition-all duration-700 ${analyzing ? 'blur-md opacity-50' : 'opacity-80 grayscale-[0.2]'}`}
                            referrerPolicy="no-referrer" 
                          />
                          {analysisResult && (
                             <div className="absolute top-4 left-4 z-10 bg-red-500 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg">
                                THREAT DETECTED: {analysisResult.threat_level}
                             </div>
                          )}
                        </div>
                      ) : (
                        <div className="text-center space-y-4 opacity-20 group-hover:opacity-40 transition-opacity">
                          <Camera size={64} strokeWidth={1} />
                          <p className="text-xs uppercase tracking-widest">Awaiting primary visual payload</p>
                        </div>
                      )}
                      
                      {analyzing && (
                        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 bg-black/40 backdrop-blur-sm">
                           <Loader2 className="animate-spin text-emerald-500" size={32} />
                           <p className="text-[10px] font-bold tracking-widest text-emerald-400">FLIGHT DATA ANALYSIS ACTIVE</p>
                        </div>
                      )}
                    </div>
                    <div className="p-4 bg-black/20 border-t border-[#30363d] flex items-center justify-between text-[11px]">
                      <span className="text-[#8b949e]">Source Auth: <span className="text-emerald-500 font-mono">RSA-4096-AES</span></span>
                      <span className="text-[#8b949e]">Status: <span className={analyzing ? 'text-blue-400' : 'text-emerald-500'}>{analyzing ? 'PROCESSING' : 'IDLE'}</span></span>
                    </div>
                  </div>

                  {/* Structured Logic */}
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 shadow-xl">
                    <div className="flex justify-between items-center mb-4">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e]">Structured Analysis JSON</h3>
                      <span className="text-[10px] text-blue-400 font-bold">ISO 14001:2015 MAPPING</span>
                    </div>
                    <div className="bg-[#0d1117] border border-[#30363d] rounded-lg p-5 overflow-x-auto">
                      {analysisResult ? (
                         <pre className="text-[11px] font-mono text-emerald-300 leading-relaxed">
{JSON.stringify({
  agent_role: analysisResult.agent_role,
  threat_level: analysisResult.threat_level,
  primary_impact: analysisResult.primary_impact,
  compliance: analysisResult.iso_compliance_status
}, null, 2)}
                         </pre>
                      ) : (
                        <p className="text-[11px] font-mono text-[#8b949e] italic">Awaiting structured output...</p>
                      )}
                    </div>
                  </div>
                </section>

                {/* Right Section: Roadmap & History */}
                <section className="col-span-12 lg:col-span-5 flex flex-col space-y-6">
                  {/* Remediation Cards */}
                  <div className="bg-[#21262d] rounded-xl p-6 border border-[#30363d] shadow-xl flex-1">
                    <h3 className="text-white font-bold mb-6 flex items-center text-sm">
                      <span className="mr-2 text-emerald-400">⚡</span> Remediation Roadmap
                    </h3>
                    <div className="space-y-6">
                      {analysisResult ? (
                        analysisResult.remediation_plan.map((step, idx) => (
                          <div key={idx} className="flex space-x-4 group">
                            <div className="w-6 h-6 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 flex items-center justify-center text-[10px] font-bold shrink-0 group-hover:bg-emerald-500 group-hover:text-white transition-all">
                              {idx + 1}
                            </div>
                            <div className="space-y-1">
                              <h4 className="text-sm font-bold text-white group-hover:text-emerald-400 transition-colors uppercase tracking-tight">{step.step}</h4>
                              <p className="text-[11px] leading-relaxed text-[#8b949e]">{step.description}</p>
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="space-y-6 opacity-30">
                           {[1,2,3].map(i => (
                             <div key={i} className="flex space-x-4">
                               <div className="w-6 h-6 rounded-full border border-dashed border-[#8b949e] flex items-center justify-center text-[10px] shrink-0">{i}</div>
                               <div className="h-4 w-2/3 bg-[#30363d] rounded animate-pulse" />
                             </div>
                           ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Site History Node */}
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-6 shadow-xl">
                    <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] mb-4 flex items-center gap-2">
                       <History size={14} /> Backboard Memory History
                    </h3>
                    <div className="space-y-4 max-h-60 overflow-y-auto custom-scrollbar pr-2">
                      {audits.map((audit) => (
                        <div key={audit.id} className="flex items-start space-x-3 text-xs">
                          <div className={`w-1 h-10 shrink-0 ${audit.threatLevel === 'CRITICAL' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                          <div className="overflow-hidden">
                            <div className="text-white font-bold flex items-center gap-2">
                              {new Date(audit.createdAt?.toDate()).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}: {audit.threatLevel}
                            </div>
                            <div className="text-[#8b949e] italic truncate w-full truncate">"{audit.findings}"</div>
                          </div>
                        </div>
                      ))}
                      {audits.length === 0 && (
                        <p className="text-[10px] text-[#8b949e] italic">No historical data in memory node...</p>
                      )}
                    </div>
                  </div>
                </section>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-12 bg-[#0d1117] text-center">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              className="space-y-8"
            >
              <div className="flex justify-center opacity-10">
                <Shield size={120} strokeWidth={0.5} />
              </div>
              <div className="space-y-2">
                <h1 className="text-5xl font-black tracking-tighter text-white uppercase italic">Zero Monitoring</h1>
                <p className="text-sm text-[#8b949e] max-w-sm mx-auto">Initialize a surveillance node to begin autonomous environmental auditing.</p>
              </div>
              <button 
                onClick={() => setShowAddSite(true)}
                className="px-8 py-3 bg-[#238636] text-white text-xs font-bold rounded-full hover:bg-[#2eaa42] transition-all transform hover:scale-105"
              >
                INITIALIZE NODE
              </button>
            </motion.div>
          </div>
        )}

        <footer className="h-12 border-t border-[#30363d] bg-[#0d1117] flex items-center justify-between px-8 text-[10px] text-[#8b949e]">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            System Status: <span className="text-emerald-500 font-bold uppercase tracking-widest">Operational</span>
          </div>
          <div className="flex space-x-6">
            <span>Verifiable ID: <span className="text-emerald-400 font-mono">agent_{user.uid.slice(0, 8)}</span></span>
            <span>API Uptime: 99.98%</span>
            <span>Signer: RSA-4096</span>
          </div>
        </footer>
      </main>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: #0d1117;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #30363d;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #484f58;
        }
      `}</style>
    </div>
  );
}
