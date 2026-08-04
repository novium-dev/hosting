CREATE TABLE project_features (
    project char(6) NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
    feature varchar(64) NOT NULL,
    PRIMARY KEY (project, feature)
);
