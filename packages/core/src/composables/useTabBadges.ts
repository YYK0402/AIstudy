import { ref } from "vue";
import { getData, queryWrongQuestions, queryDueFlashcardCount } from "../api";

/**
 * TabBar/更多弹层徽标：活跃课程（非归档）错题数与到期闪卡数求和。
 * 复习徽标取 todayStore.dueReviewTotal，不在这里重复查。
 * DATA_SAVED 订阅由消费组件（TabBar）负责，本函数保持无组件上下文依赖。
 */
export function useTabBadges() {
  const wrongTotal = ref(0);
  const cardDueTotal = ref(0);

  async function refresh(): Promise<void> {
    try {
      const data = await getData();
      const active = data.courses.filter((c) => c.status !== "archived");
      let wrong = 0;
      let cards = 0;
      for (const c of active) {
        wrong += (await queryWrongQuestions(c.id)).length;
        cards += await queryDueFlashcardCount(c.id);
      }
      wrongTotal.value = wrong;
      cardDueTotal.value = cards;
    } catch (e) {
      console.error("徽标刷新失败:", e);
    }
  }

  return { wrongTotal, cardDueTotal, refresh };
}
