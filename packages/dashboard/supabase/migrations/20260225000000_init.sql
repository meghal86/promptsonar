-- Auth/orgs
CREATE TABLE orgs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    stripe_customer_id TEXT
);

CREATE TABLE users (
    id UUID PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    org_id UUID REFERENCES orgs(id) ON DELETE SET NULL
);

CREATE TABLE projects (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    repo_url TEXT
);

-- Core data
CREATE TABLE scans (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    commit_sha TEXT,
    score INTEGER,
    json_results JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE prompts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
    content_hash TEXT,
    location JSONB,
    pillar_scores JSONB
);

CREATE TABLE waivers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    scan_id UUID REFERENCES scans(id) ON DELETE CASCADE,
    prompt_id UUID REFERENCES prompts(id) ON DELETE CASCADE,
    rule_id TEXT NOT NULL,
    waiver_code TEXT NOT NULL,
    justification TEXT,
    expires_at TIMESTAMP WITH TIME ZONE,
    CONSTRAINT check_waiver_code_format CHECK (waiver_code ~ '^WVR-[0-9]{4}-[0-9]{3}$')
);

CREATE TABLE policies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
    yaml_content JSONB
);

CREATE TABLE sboms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
    commit_sha TEXT,
    sbom_json JSONB
);

-- Billing/usage
CREATE TABLE subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
    stripe_sub_id TEXT,
    plan TEXT NOT NULL,
    seats INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE usage (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_id UUID REFERENCES orgs(id) ON DELETE CASCADE,
    scans_this_month INTEGER DEFAULT 0
);

-- Row Level Security (RLS) Enablement
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE orgs ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE scans ENABLE ROW LEVEL SECURITY;
ALTER TABLE prompts ENABLE ROW LEVEL SECURITY;
ALTER TABLE waivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE sboms ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage ENABLE ROW LEVEL SECURITY;

-- users table policies
CREATE POLICY user_read_own ON users FOR SELECT USING (id = auth.uid());
CREATE POLICY user_update_own ON users FOR UPDATE USING (id = auth.uid());

-- orgs table policies
CREATE POLICY user_read_org ON orgs FOR SELECT USING (id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY admin_update_org ON orgs FOR UPDATE USING (id = (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- projects table policies
CREATE POLICY user_manage_projects ON projects FOR ALL USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- scans table policies
CREATE POLICY user_manage_scans ON scans FOR ALL USING (project_id IN (SELECT id FROM projects WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

-- prompts table policies
CREATE POLICY user_manage_prompts ON prompts FOR ALL USING (scan_id IN (SELECT id FROM scans WHERE project_id IN (SELECT id FROM projects WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid()))));

-- waivers table policies
CREATE POLICY user_manage_waivers ON waivers FOR ALL USING (scan_id IN (SELECT id FROM scans WHERE project_id IN (SELECT id FROM projects WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid()))));

-- policies table policies
CREATE POLICY user_read_policies ON policies FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));
CREATE POLICY admin_manage_policies ON policies FOR ALL USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid() AND role = 'admin'));

-- sboms table policies
CREATE POLICY user_manage_sboms ON sboms FOR ALL USING (project_id IN (SELECT id FROM projects WHERE org_id = (SELECT org_id FROM users WHERE id = auth.uid())));

-- subscriptions table policies
CREATE POLICY user_read_subscriptions ON subscriptions FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

-- usage table policies
CREATE POLICY user_read_usage ON usage FOR SELECT USING (org_id = (SELECT org_id FROM users WHERE id = auth.uid()));

