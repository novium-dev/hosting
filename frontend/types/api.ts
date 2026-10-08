import type {
  ListDeployConfigsResponses,
  ListNodesResponses,
  ListProjectInstancesResponses,
  ListProjectUsersResponses,
} from "@/lib/api";

export type NodeRow = ListNodesResponses[200][number];
export type DeployConfig = ListDeployConfigsResponses[200][number];
export type ProjectInstance = ListProjectInstancesResponses[200][number];
export type ProjectMember = ListProjectUsersResponses[200][number];
