use daemon_common::integrity as canonical;
use database_agent_common::integrity as agent;

pub(crate) const fn severity(value: agent::IntegritySeverity) -> canonical::IntegritySeverity {
    match value {
        agent::IntegritySeverity::Ok => canonical::IntegritySeverity::Ok,
        agent::IntegritySeverity::Info => canonical::IntegritySeverity::Info,
        agent::IntegritySeverity::Warning => canonical::IntegritySeverity::Warning,
        agent::IntegritySeverity::Error => canonical::IntegritySeverity::Error,
    }
}

pub(crate) const fn category(value: agent::IntegrityCategory) -> canonical::IntegrityCategory {
    match value {
        agent::IntegrityCategory::Connectivity => canonical::IntegrityCategory::Connectivity,
        agent::IntegrityCategory::Version => canonical::IntegrityCategory::Version,
        agent::IntegrityCategory::Configuration => canonical::IntegrityCategory::Configuration,
        agent::IntegrityCategory::Database => canonical::IntegrityCategory::Database,
        agent::IntegrityCategory::Docker => canonical::IntegrityCategory::Docker,
        agent::IntegrityCategory::Storage => canonical::IntegrityCategory::Storage,
        agent::IntegrityCategory::Backup => canonical::IntegrityCategory::Backup,
        agent::IntegrityCategory::Schema => canonical::IntegrityCategory::Schema,
    }
}

pub(crate) fn finding(value: agent::IntegrityFinding) -> canonical::IntegrityFinding {
    canonical::IntegrityFinding {
        severity: severity(value.severity),
        message: value.message,
        subject: value.subject,
        details: value.details,
    }
}

pub(crate) fn check_info(value: agent::IntegrityCheckInfo) -> canonical::IntegrityCheckInfo {
    canonical::IntegrityCheckInfo {
        id: value.id,
        title: value.title,
        description: value.description,
        category: category(value.category),
        deep: value.deep,
    }
}

pub(crate) fn check_result(value: agent::IntegrityCheckResult) -> canonical::IntegrityCheckResult {
    canonical::IntegrityCheckResult {
        id: value.id,
        title: value.title,
        description: value.description,
        category: category(value.category),
        deep: value.deep,
        severity: severity(value.severity),
        duration_ms: value.duration_ms,
        findings: value.findings.into_iter().map(finding).collect(),
        skipped: value.skipped,
    }
}

pub(crate) fn report(value: agent::IntegrityReport) -> canonical::IntegrityReport {
    canonical::IntegrityReport {
        version: value.version,
        generated: value.generated,
        duration_ms: value.duration_ms,
        severity: severity(value.severity),
        checks: value.checks.into_iter().map(check_result).collect(),
    }
}

pub(crate) fn schema(value: agent::IntegritySchema) -> canonical::IntegritySchema {
    canonical::IntegritySchema {
        engine: value.engine,
        database: value.database,
        tables: value
            .tables
            .into_iter()
            .map(|table| canonical::IntegritySchemaTable {
                name: table.name,
                definition: table.definition,
            })
            .collect(),
    }
}
