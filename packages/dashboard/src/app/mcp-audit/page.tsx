'use strict';
'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface ServerViolation {
  ruleId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  title: string;
  explanation: string;
  fix: string;
}

interface McpServerConfig {
  name: string;
  status: 'passed' | 'warn' | 'failed';
  score: number;
  command: string;
  args: string[];
  env: Record<string, string>;
  violations: ServerViolation[];
  trusted: boolean;
}

const INITIAL_SERVERS: McpServerConfig[] = [
  {
    name: 'sqlite-local',
    status: 'passed',
    score: 100,
    command: 'uvx',
    args: ['mcp-server-sqlite', '--db-path', './data/secure.db'],
    env: {},
    violations: [],
    trusted: true,
  },
  {
    name: 'postgres-dev-unsecured',
    status: 'failed',
    score: 50,
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-postgres', 'postgresql://192.168.1.104:5432/production_db', '--unrestricted'],
    env: {
      "PGPASSWORD": "sk-live-51Nz8P3J2lK9qP8t5U8w2Y9x0..."
    },
    violations: [
      {
        ruleId: 'MCP-001',
        severity: 'critical',
        title: 'Untrusted Server URL / IP Exposed',
        explanation: 'The server accesses an unencrypted raw local IP address (192.168.1.104) which exposes raw production database data directly in arguments.',
        fix: 'Bind database access behind an authenticated domain proxy using secure TLS/HTTPS.'
      },
      {
        ruleId: 'MCP-002',
        severity: 'high',
        title: 'Overpermissioned Tool Scope',
        explanation: 'Command arguments contain "--unrestricted", giving absolute admin rights and wide write privileges to the model context.',
        fix: 'Scope postgres tool permissions to selective read-only tables and restrict the execution role.'
      },
      {
        ruleId: 'MCP-005',
        severity: 'high',
        title: 'Hardcoded Credentials in Environment',
        explanation: 'Detected a hardcoded API token/password pattern matching standard system variables committed directly inside environmental keys.',
        fix: 'Move the database credentials to dynamic environment parameters or secret vaults and rotate the exposed sk-live token.'
      }
    ],
    trusted: false
  },
  {
    name: 'external-github-linter',
    status: 'warn',
    score: 85,
    command: 'npx',
    args: ['-y', 'mcp-github-linter', 'https://github-external-unverified.com/lint'],
    env: {},
    violations: [
      {
        ruleId: 'MCP-006',
        severity: 'medium',
        title: 'Unverified Remote Domain',
        explanation: 'The command arguments call an external HTTP/HTTPS domain ("github-external-unverified.com") missing from the standard trust allowlist.',
        fix: 'Audit the publisher, register this domain within your organization allowlist settings, or pin package commits.'
      },
      {
        ruleId: 'MCP-003',
        severity: 'high',
        title: 'Missing Authentication Keys',
        explanation: 'The server connects to a remote third-party URL but lacks explicit bearer tokens or authentication authorization headers.',
        fix: 'Configure secure request headers or register system authorization parameters inside env variables.'
      }
    ],
    trusted: false
  },
  {
    name: 'legacy-filesystem-server',
    status: 'warn',
    score: 95,
    command: 'node',
    args: ['./dist/index.js'],
    env: {},
    violations: [
      {
        ruleId: 'MCP-007',
        severity: 'low',
        title: 'Legacy Format Config',
        explanation: 'The configuration file does not declare schemaVersion or version, preventing automated migrations checks.',
        fix: 'Add the "schemaVersion": "1.0.0" field to your central JSON file configuration.'
      }
    ],
    trusted: true
  }
];

export default function McpAuditPage() {
  const [servers, setServers] = useState<McpServerConfig[]>(INITIAL_SERVERS);
  const [selectedServerName, setSelectedServerName] = useState<string>('postgres-dev-unsecured');
  const [fuzzingState, setFuzzingState] = useState<Record<string, { fuzzing: boolean; results?: string[] }>>({});

  const selectedServer = servers.find(s => s.name === selectedServerName) || servers[0];

  const totalServers = servers.length;
  const criticalCount = servers.reduce((acc, s) => acc + s.violations.filter(v => v.severity === 'critical').length, 0);
  const highCount = servers.reduce((acc, s) => acc + s.violations.filter(v => v.severity === 'high').length, 0);
  const averageScore = Math.round(servers.reduce((acc, s) => acc + s.score, 0) / totalServers);

  const runFuzzer = (serverName: string) => {
    setFuzzingState(prev => ({
      ...prev,
      [serverName]: { fuzzing: true }
    }));

    setTimeout(() => {
      let fuzzerFindings: string[] = [];
      if (serverName === 'postgres-dev-unsecured') {
        fuzzerFindings = [
          '⚠️ Adversarial fuzzer triggered SQL injection escape: command bypassed table constraint.',
          '⚠️ Bypassed schema check: model read raw schema outline using custom fuzzed templates.',
          '⚠️ Leaked DB configuration hash via prompt redirection.'
        ];
      } else if (serverName === 'external-github-linter') {
        fuzzerFindings = [
          '⚠️ External command executed shell bypass with zero auth.',
          '⚠️ Intercepted tool-poisoning redirection payload.'
        ];
      } else {
        fuzzerFindings = [
          '✅ Fuzz simulation complete. Zero trust leaks or command escalations detected.'
        ];
      }

      setFuzzingState(prev => ({
        ...prev,
        [serverName]: { fuzzing: false, results: fuzzerFindings }
      }));
    }, 1500);
  };

  return (
    <div className="min-h-screen bg-[#FAF9F6] text-[#1C1917] font-sans antialiased">
      <main className="mx-auto max-w-6xl px-6 py-12">
        
        {/* Navigation & Header */}
        <header className="mb-10 flex flex-col gap-4 border-b border-[#E4E3DE] pb-8 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-[#A8A29E]">Desktop & CLI Auditing</p>
            <h1 className="mt-2 text-4xl font-black tracking-tight">MCP Server Security Audits</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-[#57534E]">
              Evaluate Model Context Protocol (MCP) server trust structures, verify hardcoded secrets, and discover tool poisoning threats in your local environment.
            </p>
          </div>
          <div className="flex flex-wrap gap-3 shrink-0">
            <Link href="/playground" className="rounded-full border border-[#E4E3DE] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
              Go to Playground
            </Link>
            <Link href="/policies" className="rounded-full border border-[#E4E3DE] bg-white px-5 py-2.5 text-sm font-bold text-slate-700 shadow-sm transition hover:bg-slate-50">
              Policy Controls
            </Link>
          </div>
        </header>

        {/* Global Metrics Strip */}
        <section className="grid gap-4 sm:grid-cols-4 mb-8">
          <div className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-xs">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">Overall MCP Score</p>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-4xl font-black ${averageScore >= 80 ? 'text-emerald-700' : 'text-amber-600'}`}>{averageScore}/100</span>
              <span className="text-xs text-[#87827C] font-semibold">Blended trust rating</span>
            </div>
          </div>
          <div className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-xs">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">Audited Servers</p>
            <p className="mt-2 text-4xl font-black text-slate-900">{totalServers}</p>
          </div>
          <div className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-xs">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">Critical Risks</p>
            <p className={`mt-2 text-4xl font-black ${criticalCount > 0 ? 'text-red-600' : 'text-slate-500'}`}>{criticalCount}</p>
          </div>
          <div className="rounded-2xl border border-[#E4E3DE] bg-white p-5 shadow-xs">
            <p className="text-[10px] font-black uppercase tracking-widest text-[#A8A29E]">High Threats</p>
            <p className={`mt-2 text-4xl font-black ${highCount > 0 ? 'text-amber-600' : 'text-slate-500'}`}>{highCount}</p>
          </div>
        </section>

        {/* Split Layout Section */}
        <div className="grid gap-6 md:grid-cols-12 items-start">
          
          {/* Left Column: Servers List */}
          <section className="md:col-span-5 grid gap-3">
            <h2 className="text-xs font-black uppercase tracking-wider text-[#A8A29E] mb-1">MCP Servers</h2>
            {servers.map(server => {
              const isActive = server.name === selectedServerName;
              return (
                <button
                  key={server.name}
                  onClick={() => setSelectedServerName(server.name)}
                  className={`w-full text-left rounded-2xl border p-5 shadow-xs transition-all flex justify-between items-center ${
                    isActive 
                      ? 'border-slate-950 bg-slate-950 text-white' 
                      : 'border-[#E4E3DE] bg-white hover:bg-slate-50/60 text-[#1C1917]'
                  }`}
                >
                  <div className="min-w-0 pr-3">
                    <h3 className="font-black tracking-tight text-sm truncate">{server.name}</h3>
                    <p className={`text-[10px] font-mono mt-1 ${isActive ? 'text-slate-400' : 'text-[#87827C]'}`}>
                      cmd: {server.command}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <span className={`text-xs font-black px-2.5 py-0.5 rounded-full uppercase tracking-wider ${
                      server.status === 'passed' 
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                        : (server.status === 'warn' ? 'bg-amber-100 text-amber-800 border border-amber-200' : 'bg-red-100 text-red-800 border border-red-200')
                    }`}>
                      {server.status}
                    </span>
                  </div>
                </button>
              );
            })}
          </section>

          {/* Right Column: Server Details & Audits */}
          <section className="md:col-span-7 bg-white border border-[#E4E3DE] rounded-2xl p-6 shadow-xs min-h-[500px]">
            
            {/* Header Server Name */}
            <div className="flex flex-col sm:flex-row justify-between sm:items-center border-b border-[#E4E3DE] pb-4 mb-6 gap-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-[0.16em] text-[#A8A29E]">Auditing Context</span>
                <h2 className="text-2xl font-black text-slate-900 tracking-tight mt-1">{selectedServer.name}</h2>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-lg font-black px-3.5 py-1 rounded-xl border ${
                  selectedServer.score >= 80 
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-100' 
                    : (selectedServer.score >= 70 ? 'bg-amber-50 text-amber-600 border-amber-100' : 'bg-red-50 text-red-600 border-red-100')
                }`}>
                  Score: {selectedServer.score}/100
                </span>
              </div>
            </div>

            {/* Config Specs */}
            <div className="mb-6 grid gap-4 bg-[#FAF9F6] border border-[#E4E3DE]/60 rounded-xl p-4 font-mono text-xs">
              <div>
                <span className="text-[9px] text-[#A8A29E] uppercase font-bold tracking-wider block mb-1">Execution Command</span>
                <span className="text-slate-800 font-bold">{selectedServer.command}</span>
              </div>
              {selectedServer.args.length > 0 && (
                <div>
                  <span className="text-[9px] text-[#A8A29E] uppercase font-bold tracking-wider block mb-1">Arguments</span>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {selectedServer.args.map((arg, idx) => (
                      <span key={idx} className="bg-white border border-[#E4E3DE] px-2 py-0.5 rounded text-slate-700">
                        {arg}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {Object.keys(selectedServer.env).length > 0 && (
                <div>
                  <span className="text-[9px] text-[#A8A29E] uppercase font-bold tracking-wider block mb-1">Environment Variables</span>
                  <div className="grid gap-1 mt-1">
                    {Object.entries(selectedServer.env).map(([key, val]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-[#87827C] font-bold shrink-0">{key}:</span>
                        <span className="text-slate-800 break-all">{val}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Rules Check list */}
            <div className="mb-6">
              <h3 className="text-[10px] font-black uppercase tracking-wider text-[#A8A29E] mb-3">7-Pillar Config Integrity Check</h3>
              <div className="grid gap-2 text-xs">
                
                {/* 1. TLS Check */}
                <div className="flex items-center justify-between border border-[#E4E3DE]/40 rounded-lg p-3 bg-slate-50/40">
                  <span className="font-semibold text-slate-700">TLS Encryption (MCP-001)</span>
                  <span className={`font-bold uppercase tracking-wider text-[10px] ${selectedServer.violations.some(v => v.ruleId === 'MCP-001') ? 'text-red-600' : 'text-emerald-700'}`}>
                    {selectedServer.violations.some(v => v.ruleId === 'MCP-001') ? 'FAIL (UNENCRYPTED)' : 'PASS (SECURE)'}
                  </span>
                </div>

                {/* 2. Permission scopes */}
                <div className="flex items-center justify-between border border-[#E4E3DE]/40 rounded-lg p-3 bg-slate-50/40">
                  <span className="font-semibold text-slate-700">Least Privilege Scoping (MCP-002)</span>
                  <span className={`font-bold uppercase tracking-wider text-[10px] ${selectedServer.violations.some(v => v.ruleId === 'MCP-002') ? 'text-red-600' : 'text-emerald-700'}`}>
                    {selectedServer.violations.some(v => v.ruleId === 'MCP-002') ? 'FAIL (OVERPERMISSIONED)' : 'PASS (SCOPED)'}
                  </span>
                </div>

                {/* 3. Auth Check */}
                <div className="flex items-center justify-between border border-[#E4E3DE]/40 rounded-lg p-3 bg-slate-50/40">
                  <span className="font-semibold text-slate-700">Endpoint Authentication (MCP-003)</span>
                  <span className={`font-bold uppercase tracking-wider text-[10px] ${selectedServer.violations.some(v => v.ruleId === 'MCP-003') ? 'text-red-600' : 'text-emerald-700'}`}>
                    {selectedServer.violations.some(v => v.ruleId === 'MCP-003') ? 'FAIL (NO AUTH)' : 'PASS (AUTHENTICATED)'}
                  </span>
                </div>

                {/* 4. Injection text */}
                <div className="flex items-center justify-between border border-[#E4E3DE]/40 rounded-lg p-3 bg-slate-50/40">
                  <span className="font-semibold text-slate-700">Directive Injection Safety (MCP-004)</span>
                  <span className={`font-bold uppercase tracking-wider text-[10px] ${selectedServer.violations.some(v => v.ruleId === 'MCP-004') ? 'text-red-600' : 'text-emerald-700'}`}>
                    {selectedServer.violations.some(v => v.ruleId === 'MCP-004') ? 'FAIL (OVERRIDE DIRECTIVES)' : 'PASS (CLEAN)'}
                  </span>
                </div>

                {/* 5. Hardcoded secret scan */}
                <div className="flex items-center justify-between border border-[#E4E3DE]/40 rounded-lg p-3 bg-slate-50/40">
                  <span className="font-semibold text-slate-700">Secrets Hardcoding (MCP-005)</span>
                  <span className={`font-bold uppercase tracking-wider text-[10px] ${selectedServer.violations.some(v => v.ruleId === 'MCP-005') ? 'text-red-600' : 'text-emerald-700'}`}>
                    {selectedServer.violations.some(v => v.ruleId === 'MCP-005') ? 'FAIL (EXPOSED SECRET)' : 'PASS (SAFE)'}
                  </span>
                </div>

                {/* 6. Allowlist Domain check */}
                <div className="flex items-center justify-between border border-[#E4E3DE]/40 rounded-lg p-3 bg-slate-50/40">
                  <span className="font-semibold text-slate-700">Trust Allowlist Domain (MCP-006)</span>
                  <span className={`font-bold uppercase tracking-wider text-[10px] ${selectedServer.violations.some(v => v.ruleId === 'MCP-006') ? 'text-amber-600' : 'text-emerald-700'}`}>
                    {selectedServer.violations.some(v => v.ruleId === 'MCP-006') ? 'WARNING (UNVERIFIED)' : 'PASS (TRUSTED)'}
                  </span>
                </div>

                {/* 7. Schema format check */}
                <div className="flex items-center justify-between border border-[#E4E3DE]/40 rounded-lg p-3 bg-slate-50/40">
                  <span className="font-semibold text-slate-700">Configuration Format Version (MCP-007)</span>
                  <span className={`font-bold uppercase tracking-wider text-[10px] ${selectedServer.violations.some(v => v.ruleId === 'MCP-007') ? 'text-[#87827C]' : 'text-emerald-700'}`}>
                    {selectedServer.violations.some(v => v.ruleId === 'MCP-007') ? 'WARNING (LEGACY)' : 'PASS (CURRENT)'}
                  </span>
                </div>

              </div>
            </div>

            {/* Violations List */}
            {selectedServer.violations.length > 0 ? (
              <div className="mb-6 border-t border-[#E4E3DE] pt-6">
                <h3 className="text-[10px] font-black uppercase tracking-wider text-red-700 mb-4">Security Violations Found</h3>
                <div className="grid gap-4">
                  {selectedServer.violations.map(v => (
                    <div key={v.ruleId} className="border border-red-100 rounded-xl p-4 bg-red-50/30 flex flex-col gap-2">
                      <div className="flex justify-between items-center flex-wrap gap-2">
                        <span className="font-bold text-slate-900 text-sm">{v.title}</span>
                        <span className="text-[9px] font-black uppercase tracking-wider bg-red-100 text-red-700 px-2 py-0.5 rounded">
                          {v.ruleId} • {v.severity}
                        </span>
                      </div>
                      <p className="text-xs text-[#57534E] leading-relaxed">{v.explanation}</p>
                      
                      {/* suggested fix */}
                      <div className="mt-2 bg-white border border-[#E4E3DE] rounded-lg p-3 font-mono text-xs text-slate-700">
                        <span className="text-[9px] font-sans font-bold text-[#A8A29E] uppercase block mb-1">Suggested Mitigation Fix</span>
                        {v.fix}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="mb-6 border-t border-[#E4E3DE] pt-6 flex flex-col items-center justify-center text-center p-8 bg-emerald-50/10 border border-dashed border-emerald-200 rounded-xl">
                <span className="text-3xl mb-2">🛡️</span>
                <h4 className="font-black text-sm text-emerald-800">Clean Security Audit</h4>
                <p className="text-xs text-[#57534E] mt-1">This MCP server config complies perfectly with all trust, authorization, and TLS boundaries.</p>
              </div>
            )}

            {/* Manual Fuzzer Simulator & Interactive triggers */}
            <div className="border-t border-[#E4E3DE] pt-6 flex flex-col gap-4">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h3 className="text-[10px] font-black uppercase tracking-wider text-slate-900">Manual Fuzzer Simulator</h3>
                  <p className="text-xs text-[#57534E] mt-1">Inject adversarial overrides to verify server resilience against tool poisoning leaks.</p>
                </div>
                <button
                  onClick={() => runFuzzer(selectedServer.name)}
                  disabled={fuzzingState[selectedServer.name]?.fuzzing}
                  className="rounded-full bg-slate-950 px-5 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-slate-800 disabled:opacity-50 shrink-0 uppercase tracking-wider"
                >
                  {fuzzingState[selectedServer.name]?.fuzzing ? 'Simulating Fuzzing...' : 'Trigger Local Fuzzer'}
                </button>
              </div>

              {/* Fuzzer logs display */}
              {fuzzingState[selectedServer.name] && (
                <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 font-mono text-[11px] text-slate-200 flex flex-col gap-2">
                  <div className="flex justify-between items-center border-b border-slate-800 pb-2 mb-1">
                    <span className="text-slate-400 uppercase tracking-widest text-[9px] font-bold">Fuzzer Audit Terminal</span>
                    <span className={`w-2 h-2 rounded-full ${fuzzingState[selectedServer.name]?.fuzzing ? 'bg-amber-500 animate-ping' : 'bg-emerald-500'}`}></span>
                  </div>
                  
                  {fuzzingState[selectedServer.name]?.fuzzing ? (
                    <div className="flex flex-col gap-1 text-slate-400">
                      <div>$ promptsonar fuzz-mcp --target {selectedServer.name}</div>
                      <div className="animate-pulse">Loading vectors database... [157 vectors loaded]</div>
                      <div className="animate-pulse">Injecting escape parameters...</div>
                    </div>
                  ) : (
                    <div className="flex flex-col gap-2">
                      <div>$ promptsonar fuzz-mcp --target {selectedServer.name}</div>
                      {fuzzingState[selectedServer.name]?.results?.map((res, idx) => (
                        <div key={idx} className={res.startsWith('✅') ? 'text-emerald-400' : 'text-rose-400'}>
                          {res}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>

          </section>

        </div>

      </main>
    </div>
  );
}
