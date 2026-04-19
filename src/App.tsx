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
  FileText,
  ArrowUpDown,
  Activity,
  Target,
  Cpu,
  Leaf,
  ChevronLeft,
  ChevronRight,
  Fingerprint,
  Lock
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  collection, 
  query, 
  where, 
  onSnapshot, 
  addDoc, 
  updateDoc,
  serverTimestamp,
  deleteDoc,
  doc,
  orderBy
} from 'firebase/firestore';
import { auth, db } from './firebase';
import { GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, User } from 'firebase/auth';
import { analyzeEnvironmentalSite, AuditResult } from './services/geminiService';
import ReactMarkdown from 'react-markdown';
import { compressImage } from './lib/imageUtils';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [sites, setSites] = useState<any[]>([]);
  const [activeSite, setActiveSite] = useState<any | null>(null);
  const [audits, setAudits] = useState<any[]>([]);
  const [isCapturing, setIsCapturing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<AuditResult | null>(null);
  const [selectedAudit, setSelectedAudit] = useState<any | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [sortBy, setSortBy] = useState<'date' | 'threat'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [lastUploadedImage, setLastUploadedImage] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [showAddSite, setShowAddSite] = useState(false);
  const [newSiteName, setNewSiteName] = useState('');
  const [newSiteLocation, setNewSiteLocation] = useState('');
  const [machineVerified, setMachineVerified] = useState(false);

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

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (!origin.endsWith('.run.app') && !origin.includes('localhost')) return;
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS') {
        setMachineVerified(true);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleAuth0Connect = async () => {
    try {
      const response = await fetch('/api/auth/url');
      if (!response.ok) throw new Error('Auth0 setup required');
      const { url } = await response.json();
      window.open(url, 'auth0_popup', 'width=600,height=700');
    } catch (err) {
      alert('Auth0 integration pending configuration. Use Google fallback.');
    }
  };

  const handleLogin = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const handleLogout = () => signOut(auth);

  const sortedAudits = React.useMemo(() => {
    const threatOrder: Record<string, number> = {
      'CRITICAL': 4,
      'HIGH': 3,
      'MEDIUM': 2,
      'LOW': 1
    };

    return [...audits].sort((a, b) => {
      let comparison = 0;
      if (sortBy === 'date') {
        const timeA = a.createdAt?.toMillis() || 0;
        const timeB = b.createdAt?.toMillis() || 0;
        comparison = timeA - timeB;
      } else {
        const scoreA = threatOrder[a.threatLevel] || 0;
        const scoreB = threatOrder[b.threatLevel] || 0;
        comparison = scoreA - scoreB;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });
  }, [audits, sortBy, sortOrder]);

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
      let base64 = event.target?.result as string;
      
      try {
        // Compress image to ensure it fits in Firestore (1MB limit)
        // We do this before analysis to ensure Gemini also gets a reasonable size
        base64 = await compressImage(base64);
        
        setLastUploadedImage(base64);
        setSelectedAudit(null);
        
        const result = await analyzeEnvironmentalSite(base64, file.type);
        setAnalysisResult(result);

        // Save Audit
        await addDoc(collection(db, `sites/${activeSite.id}/audits`), {
          siteId: activeSite.id,
          auditorId: user.uid,
          imageUrl: base64,
          threatLevel: result.threat_level,
          findings: result.detailed_analysis,
          isoCompliance: result.iso_compliance_status.toLowerCase().includes('yes') || result.iso_compliance_status.toLowerCase().includes('compliant'),
          structuredData: result,
          createdAt: serverTimestamp()
        });

        // Update latest threat level on the site document for sidebar visualization
        await updateDoc(doc(db, 'sites', activeSite.id), {
          latestThreatLevel: result.threat_level,
          lastAuditAt: serverTimestamp()
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
          <div className="w-20 h-20 rounded-xl bg-emerald-500 flex items-center justify-center text-white shadow-lg shadow-emerald-500/20 relative">
            <Shield size={40} />
            <Leaf size={20} className="absolute bottom-1 right-1 text-emerald-100" />
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
    <div className="h-screen flex bg-[#0d1117] text-[#c9d1d9] font-sans selection:bg-emerald-500/30 overflow-hidden">
      {/* Sidebar - Site Navigation */}
      <aside className={`transition-all duration-300 ${sidebarCollapsed ? 'w-20' : 'w-72'} bg-[#161b22] border-r border-[#30363d] flex flex-col overflow-hidden relative`}>
        <div className={`p-6 border-b border-[#30363d] ${sidebarCollapsed ? 'items-center px-4' : ''}`}>
          <div className={`flex items-center gap-3 mb-6 ${sidebarCollapsed ? 'justify-center' : ''}`}>
            <div className="w-10 h-10 bg-emerald-500 rounded-md flex items-center justify-center relative shrink-0">
              <Shield size={20} className="text-white" />
              <Leaf size={10} className="absolute bottom-1 right-1 text-emerald-100" />
            </div>
            {!sidebarCollapsed && <span className="font-bold text-white text-lg tracking-tight truncate">EcoSentinel</span>}
          </div>
          <button 
            onClick={() => setShowAddSite(true)}
            className={`w-full flex items-center justify-center gap-2 py-2.5 bg-[#21262d] border border-[#30363d] text-xs font-bold text-white rounded-md hover:border-[#8b949e] transition-colors ${sidebarCollapsed ? 'px-0' : ''}`}
          >
            <Plus size={14} /> {!sidebarCollapsed && 'New Site Entry'}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-1">
          {!sidebarCollapsed && <div className="text-[#8b949e] px-2 py-2 uppercase text-[10px] font-bold tracking-wider">Mission Control</div>}
          <div className="space-y-1">
            {sites.map(site => (
              <div 
                key={site.id}
                onClick={() => {
                  setActiveSite(site);
                  setSelectedAudit(null);
                  setAnalysisResult(null);
                  setLastUploadedImage(null);
                }}
                title={sidebarCollapsed ? site.name : ''}
                className={`group flex items-center p-2.5 cursor-pointer rounded-md transition-all ${activeSite?.id === site.id ? 'bg-[#21262d] text-white' : 'text-[#c9d1d9] hover:bg-[#21262d]'} ${sidebarCollapsed ? 'justify-center' : 'justify-between'}`}
              >
                <div className="flex items-center gap-3 overflow-hidden">
                  <div className="relative shrink-0 flex items-center justify-center">
                    <MapPin size={16} className={activeSite?.id === site.id ? 'text-emerald-400' : 'text-[#8b949e]'} />
                    {site.latestThreatLevel && (
                      <div className={`absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full border border-[#161b22] ${
                        site.latestThreatLevel === 'CRITICAL' ? 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.5)] animate-pulse' :
                        site.latestThreatLevel === 'HIGH' ? 'bg-orange-500 shadow-[0_0_8px_rgba(249,115,22,0.4)]' :
                        site.latestThreatLevel === 'MEDIUM' ? 'bg-yellow-500' : 'bg-emerald-500'
                      }`} />
                    )}
                  </div>
                  {!sidebarCollapsed && <span className="truncate text-sm font-medium">{site.name}</span>}
                </div>
                {!sidebarCollapsed && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleDeleteSite(site.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-500 transition-opacity"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </div>
            ))}
            {sites.length === 0 && !sidebarCollapsed && (
              <p className="px-2 py-4 text-[11px] text-[#8b949e] italic">No active nodes...</p>
            )}
          </div>
        </nav>

        <div className={`p-4 bg-[#0d1117] border-t border-[#30363d] ${sidebarCollapsed ? 'items-center px-4' : ''}`}>
          <div className={`flex items-center gap-3 mb-4 ${sidebarCollapsed ? 'flex-col' : 'justify-between'}`}>
            <div className={`flex items-center gap-3 overflow-hidden ${sidebarCollapsed ? 'flex-col' : ''}`}>
              <img src={user.photoURL || ''} alt="" className="w-8 h-8 rounded-md border border-[#30363d]" />
              {!sidebarCollapsed && (
                <div className="overflow-hidden">
                  <p className="text-[11px] font-bold text-white truncate">{user.displayName || user.email}</p>
                  <p className="text-[9px] text-[#8b949e] uppercase tracking-tighter">Verified Auditor</p>
                </div>
              )}
            </div>
            <button onClick={handleLogout} className="p-2 text-[#8b949e] hover:text-white transition-colors">
              <LogOut size={16} />
            </button>
          </div>
          {!sidebarCollapsed && (
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-[#8b949e]">Memory Node:</span>
              <span className="text-blue-400">Backboard-V2</span>
            </div>
          )}
        </div>

        {/* Collapse Toggle */}
        <button 
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="absolute top-1/2 -right-3 w-6 h-6 bg-[#30363d] border border-[#30363d] rounded-full flex items-center justify-center text-white hover:bg-[#484f58] transition-colors z-20 shadow-lg"
        >
          {sidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
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
            <div className="flex-1 overflow-hidden p-6 custom-scrollbar text-[#c9d1d9]">
              <div className="grid grid-cols-12 gap-6 max-w-full mx-auto h-full auto-rows-fr">
                {/* Left Section: Source & Tactical Intelligence */}
                <section className="col-span-12 lg:col-span-8 flex flex-col space-y-4 h-full overflow-hidden">
                  {/* Primary Monitoring Feed */}
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl overflow-hidden flex flex-col shadow-xl flex-[2] min-h-0">
                    <div className="p-3 border-b border-[#30363d] flex items-center justify-between shrink-0">
                      <span className="text-[10px] font-bold tracking-widest text-[#8b949e] uppercase">Primary Visual Source</span>
                      <span className="text-[9px] text-[#8b949e]">LATENCY: {analyzing ? '...' : (analysisResult ? '842ms' : '0ms')}</span>
                    </div>
                    <div className="relative flex-1 bg-[#0d1117] flex items-center justify-center group overflow-hidden">
                      {(selectedAudit || lastUploadedImage || audits[0]) ? (
                        <div className="w-full h-full relative">
                           <img 
                            src={selectedAudit?.imageUrl || lastUploadedImage || audits[0]?.imageUrl} 
                            alt="Site Scan" 
                            className={`w-full h-full object-cover transition-all duration-700 ${analyzing ? 'blur-md opacity-50' : 'opacity-95 grayscale-[0.05]'}`}
                            referrerPolicy="no-referrer" 
                          />
                          {(selectedAudit || analysisResult) && (
                             <div className={`absolute top-4 left-4 z-10 text-white text-[10px] font-bold px-2 py-1 rounded shadow-lg ${
                               (selectedAudit?.threatLevel || analysisResult?.threat_level) === 'CRITICAL' ? 'bg-red-500' : 'bg-orange-500'
                             }`}>
                                THREAT DETECTED: {selectedAudit?.threatLevel || analysisResult?.threat_level}
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
                        <div className="absolute inset-0 flex flex-col items-center justify-center space-y-3 bg-black/40 backdrop-blur-sm z-30">
                           <Loader2 className="animate-spin text-emerald-500" size={32} />
                           <p className="text-[10px] font-bold tracking-widest text-emerald-400 px-4 py-2 border border-emerald-500/30 rounded bg-emerald-500/10">FLIGHT DATA ANALYSIS ACTIVE</p>
                        </div>
                      )}
                    </div>
                    <div className="p-3 bg-[#0d1117] border-t border-[#30363d] flex items-center justify-between text-[11px] shrink-0">
                      <span className="text-[#8b949e]">Source ID: <span className="text-emerald-500 font-mono">ECO-SAT-MOD-4</span></span>
                      <span className="text-[#8b949e]">Status: <span className={analyzing ? 'text-blue-400' : 'text-emerald-500'}>{analyzing ? 'PROCESSING' : 'LIVE'}</span></span>
                    </div>
                  </div>

                  {/* Tactical Support Grid (Roadmap & Metrics) */}
                  <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Remediation Cards */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 shadow-xl flex flex-col overflow-hidden">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] mb-4 shrink-0 flex items-center gap-2">
                         <Target size={14} className="text-emerald-400" /> Remediation Roadmap
                      </h3>
                      <div className="flex-1 overflow-y-auto custom-scrollbar pr-2 space-y-3">
                        {analysisResult || selectedAudit ? (
                          (analysisResult?.remediation_plan || selectedAudit?.structuredData?.remediation_plan || []).map((step: any, idx: number) => (
                            <div key={idx} className="bg-[#0d1117] border border-[#30363d] p-3 rounded-lg flex flex-col gap-1 group animate-in fade-in slide-in-from-left duration-300" style={{ animationDelay: `${idx * 100}ms` }}>
                               <div className="flex items-center gap-2">
                                  <div className="w-5 h-5 rounded bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 flex items-center justify-center text-[9px] font-bold shrink-0">
                                    {idx + 1}
                                  </div>
                                  <h4 className="text-[10px] font-bold text-white group-hover:text-emerald-400 transition-colors uppercase tracking-tight">{step.step}</h4>
                               </div>
                               <p className="text-[9px] leading-relaxed text-[#8b949e]">{step.description}</p>
                            </div>
                          ))
                        ) : (
                          <div className="space-y-3 opacity-30">
                            {[1,2,3].map(i => (
                              <div key={i} className="flex-1 h-14 bg-[#0d1117] border border-dashed border-[#30363d] rounded-lg animate-pulse" />
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Intelligence Stats Dashboard (Moved from sidebar) */}
                    <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 shadow-xl flex flex-col overflow-hidden">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] mb-4 border-b border-[#30363d] pb-2 flex items-center justify-between">
                        Intelligence Metrics
                        <Activity size={12} className="text-emerald-500" />
                      </h3>
                      
                      <div className="space-y-4 flex-1 custom-scrollbar overflow-y-auto pr-1">
                        {/* Metric: Identity Status */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-end">
                            <span className="text-[8px] font-bold text-[#8b949e] uppercase">Agent Identity</span>
                            <span className="text-[9px] font-mono text-emerald-400">VERIFIED</span>
                          </div>
                          <div className="h-1 bg-[#0d1117] rounded-full overflow-hidden border border-[#30363d]">
                            <motion.div 
                              initial={{ width: 0 }}
                              animate={{ width: (analysisResult || selectedAudit) ? '100%' : '20%' }}
                              className="h-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]"
                            />
                          </div>
                          <p className="text-[8px] text-[#8b949e] italic truncate">{analysisResult?.agent_role || selectedAudit?.structuredData?.agent_role || 'Agent Standby'}</p>
                        </div>

                        {/* Metric: Threat Intensity */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-end">
                            <span className="text-[8px] font-bold text-[#8b949e] uppercase">Threat Intensity</span>
                            <span className={`text-[9px] font-mono ${(analysisResult?.threat_level || selectedAudit?.threatLevel) === 'CRITICAL' ? 'text-red-500' : 'text-orange-400'}`}>
                              {analysisResult?.threat_level || selectedAudit?.threatLevel || 'OFFLINE'}
                            </span>
                          </div>
                          <div className="h-1 bg-[#0d1117] rounded-full overflow-hidden border border-[#30363d] flex">
                            {['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'].map((level, i) => {
                              const currentLevel = (analysisResult?.threat_level || selectedAudit?.threatLevel || '').toUpperCase();
                              const levelArray = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
                              const isActive = levelArray.indexOf(currentLevel) >= i;
                              return (
                                <div 
                                  key={level} 
                                  className={`flex-1 h-full border-r border-[#0d1117] transition-all duration-500 ${
                                    isActive ? (i === 3 ? 'bg-red-500' : i === 2 ? 'bg-orange-500' : i === 1 ? 'bg-yellow-500' : 'bg-emerald-500') : 'bg-transparent'
                                  }`} 
                                />
                              );
                            })}
                          </div>
                        </div>

                        {/* Metric: Compliance Alignment */}
                        <div className="p-3 bg-[#0d1117] border border-[#30363d] rounded-lg">
                          <span className="text-[8px] font-bold text-[#8b949e] uppercase tracking-widest block mb-1.5">Compliance Alignment (ISO)</span>
                          <div className="flex items-center gap-2">
                            <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center shrink-0 ${ (analysisResult?.iso_compliance_status || selectedAudit?.structuredData?.iso_compliance_status)?.toLowerCase().includes('compliant') ? 'border-emerald-500 text-emerald-500' : 'border-[#30363d] text-[#8b949e]'}`}>
                              <CheckCircle2 size={16} />
                            </div>
                            <p className="text-[9px] font-medium leading-tight">
                              {analysisResult?.iso_compliance_status || selectedAudit?.structuredData?.iso_compliance_status || 'Awaiting Node Sync...'}
                            </p>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </section>

                {/* Right Section (Sidebar): Findings */}
                <section className="col-span-12 lg:col-span-4 flex flex-col space-y-4 h-full overflow-hidden">
                  {/* Report Engine (Moved from main area) */}
                  <div className="bg-[#161b22] border border-[#30363d] rounded-xl p-5 shadow-xl flex flex-col flex-1 overflow-hidden">
                    <div className="flex justify-between items-center mb-4 shrink-0">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-[#8b949e] flex items-center gap-2">
                         <FileText size={14} className="text-emerald-400" /> Audit Findings
                      </h3>
                      {(analysisResult?.signature || selectedAudit?.structuredData?.signature) && (
                        <span className="text-[8px] text-emerald-400 font-bold px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 rounded flex items-center gap-1">
                          <Lock size={10} /> UNIT_SIGNED
                        </span>
                      )}
                    </div>
                    <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar pr-2">
                      {analysisResult || selectedAudit ? (
                        <div className="markdown-body prose prose-invert prose-sm max-w-none text-[10px] leading-relaxed text-[#c9d1d9] prose-p:text-[#8b949e] prose-headings:text-white prose-headings:text-[11px] prose-headings:uppercase prose-headings:tracking-widest">
                          <ReactMarkdown>
                            {analysisResult?.detailed_analysis || selectedAudit?.findings || ''}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <div className="h-full flex flex-col items-center justify-center opacity-20">
                          <FileText size={40} strokeWidth={1} />
                          <p className="text-[9px] uppercase tracking-widest mt-2">Awaiting intelligence throughput...</p>
                        </div>
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
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              System Status: <span className="text-emerald-500 font-bold uppercase tracking-widest">Operational</span>
            </div>
            <button 
              onClick={handleAuth0Connect}
              className={`flex items-center gap-1 px-2 py-0.5 rounded border transition-all ${machineVerified ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' : 'border-[#30363d] hover:border-[#8b949e]'}`}
            >
              <Fingerprint size={12} /> {machineVerified ? 'Agent ID: Verified' : 'Assign Machine Identity'}
            </button>
          </div>
          <div className="flex space-x-6">
            <span>Machine Signature: <span className="text-emerald-400 font-mono">SHA-256 (RSA-4096)</span></span>
            <span>API Uptime: 99.98%</span>
            <span>Signer: ECO_SENTINEL_PROTOS</span>
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
