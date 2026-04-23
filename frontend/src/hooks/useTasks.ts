import { useState, useEffect, useCallback } from "react";
import { Task, CreateTaskRequest, UpdateTaskRequest, ListTasksQuery, ApiResponse } from "../../backend/shared/types";

const API_BASE = import.meta.env.VITE_API_URL as string;

// ── Generic fetch helper ──────────────────────────────────────────────────────

async function apiFetch<T>(path: string, options?: RequestInit): Promise<ApiResponse<T>> {
  const token = localStorage.getItem("id_token");
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  });
  return res.json() as Promise<ApiResponse<T>>;
}

// ── useTasks ──────────────────────────────────────────────────────────────────

export function useTasks(query: ListTasksQuery = {}) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nextKey, setNextKey] = useState<string | undefined>();

  const qs = new URLSearchParams(Object.entries(query).filter(([, v]) => v != null) as [string, string][]).toString();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const result = await apiFetch<Task[]>(`/tasks${qs ? `?${qs}` : ""}`);
      if (!result.success) throw new Error(result.error);
      setTasks(result.data ?? []);
      setNextKey(result.pagination?.nextKey);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => { load(); }, [load]);

  return { tasks, loading, error, nextKey, refresh: load };
}

// ── useTask ───────────────────────────────────────────────────────────────────

export function useTask(taskId: string | null) {
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!taskId) return;
    setLoading(true);
    apiFetch<Task>(`/tasks/${taskId}`)
      .then((r) => { if (r.success) setTask(r.data ?? null); })
      .finally(() => setLoading(false));
  }, [taskId]);

  return { task, loading };
}

// ── useCreateTask ─────────────────────────────────────────────────────────────

export function useCreateTask() {
  const [loading, setLoading] = useState(false);

  const create = async (body: CreateTaskRequest): Promise<Task | null> => {
    setLoading(true);
    try {
      const result = await apiFetch<Task>("/tasks", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (!result.success) throw new Error(result.error);
      return result.data ?? null;
    } finally {
      setLoading(false);
    }
  };

  return { create, loading };
}

// ── useUpdateTask ─────────────────────────────────────────────────────────────

export function useUpdateTask() {
  const [loading, setLoading] = useState(false);

  const update = async (taskId: string, body: Partial<UpdateTaskRequest>): Promise<boolean> => {
    setLoading(true);
    try {
      const result = await apiFetch(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      return result.success;
    } finally {
      setLoading(false);
    }
  };

  return { update, loading };
}

// ── useDeleteTask ─────────────────────────────────────────────────────────────

export function useDeleteTask() {
  const remove = async (taskId: string): Promise<boolean> => {
    const result = await apiFetch(`/tasks/${taskId}`, { method: "DELETE" });
    return result.success;
  };
  return { remove };
}
