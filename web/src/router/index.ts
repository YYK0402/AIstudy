import { createRouter, createWebHashHistory } from "vue-router";

// 思源页签 URL 形如 /stage/build/desktop/?r=xxx，需把 pathname + search 作为 base，
// 否则 hash 路由生成的链接会丢失 path 与 query，点击侧栏会跳转到思源首页
const router = createRouter({
  history: createWebHashHistory(location.pathname + location.search),
  routes: [
    { path: "/", name: "home", component: () => import("../views/HomeView.vue") },
    { path: "/course", name: "course", component: () => import("../views/CourseHomeView.vue") },
    { path: "/content", name: "content", component: () => import("../views/CourseContentView.vue") },
    { path: "/plan", name: "plan", component: () => import("../views/StudyPlanView.vue") },
    { path: "/study", name: "study", component: () => import("../views/StudyView.vue") },
    { path: "/quiz", name: "quiz", component: () => import("../views/QuizView.vue") },
    { path: "/wrong", name: "wrong", component: () => import("../views/WrongView.vue") },
    { path: "/review", name: "review", component: () => import("../views/ReviewView.vue") },
    { path: "/graph", name: "graph", component: () => import("../views/GraphView.vue") },
    { path: "/report", name: "report", component: () => import("../views/ReportView.vue") },
    { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },
  ],
});

export default router;
