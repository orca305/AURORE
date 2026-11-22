import { requestCase } from "./requests";
import { TaskList, type Task } from "./task-list";

/** 사건의 "다음 할 일" 번호 목록. 불러오지 못하면 사건 화면의 나머지는 그대로 보여 준다. */
export async function CaseTasks({ id }: { id: string }) {
  const response = await requestCase("/" + id + "/tasks");
  const data = response?.ok ? ((await response.json().catch(() => null)) as { max: number; items: Task[] } | null) : null;
  if (!data) return <section aria-label="다음 할 일"><h2>다음 할 일</h2><p role="status">할 일을 불러오지 못했어요. 잠시 후 다시 열어 주세요.</p></section>;
  return <TaskList caseId={id} items={data.items} max={data.max} />;
}
