import { createRouter, createWebHashHistory } from "vue-router";

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: "/", name: "home", component: () => import("../views/HomeView.vue") },
    { path: "/course", name: "course", component: () => import("../views/CourseHomeView.vue") },
    { path: "/content", name: "content", component: () => import("../views/CourseContentView.vue") },
    { path: "/plan", name: "plan", component: () => import("../views/StudyPlanView.vue") },
    { path: "/study", name: "study", component: () => import("../views/StudyView.vue") },
    { path: "/quiz", name: "quiz", component: () => import("../views/QuizView.vue") },
    { path: "/wrong", name: "wrong", component: () => import("../views/WrongView.vue") },
    { path: "/graph", name: "graph", component: () => import("../views/GraphView.vue") },
    { path: "/report", name: "report", component: () => import("../views/ReportView.vue") },
    { path: "/settings", name: "settings", component: () => import("../views/SettingsView.vue") },
  ],
});

export default router;
