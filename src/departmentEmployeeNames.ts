import { normalizeDepartmentMaxLeaders } from "./departmentSettings";

export const DEPARTMENT_EMPLOYEE_NAMES = [
  "王磊", "李娜", "张伟", "刘洋", "陈静", "杨帆", "黄丽", "赵刚", "吴敏", "周杰",
  "徐婷", "孙浩", "马超", "朱琳", "胡斌", "郭玲", "何平", "高鹏", "林燕", "罗倩",
  "郑爽", "梁波", "谢芳", "宋佳", "唐健", "许洁", "韩梅", "邓辉", "曹阳", "彭飞",
  "曾霞", "萧宇", "田甜", "董雪", "袁明", "潘军", "于洋", "蒋欣", "蔡琴", "余亮",
  "杜娟", "叶青", "程晨", "苏宁", "魏强", "吕佳", "丁宁", "任华", "沈悦", "姚瑶",
  "卢俊", "姜楠", "崔岩", "钟杰", "谭丽", "陆峰", "汪颖", "范凯", "金鑫", "石磊",
  "廖凡", "贾敏", "夏雨", "韦芳", "付强", "方圆", "白雪", "邹莉", "孟杰", "熊伟",
  "秦悦", "邱琳", "江涛", "尹航", "薛冰", "闫旭", "段阳", "雷鸣", "侯静", "龙飞",
  "史博", "陶然", "黎明", "顾佳", "毛宁", "郝杰", "龚雪", "邵丹", "万鹏", "钱程",
  "戴颖", "严莉", "莫凡", "孔亮", "向荣", "汤杰", "常乐", "温馨", "康健", "施慧",
] as const;

export function getDepartmentEmployeeName(leaderNumber: number, maxLeaders: number, employeeNumber: number): string {
  const nameCount = DEPARTMENT_EMPLOYEE_NAMES.length;
  const leaderCount = normalizeDepartmentMaxLeaders(maxLeaders);
  const slotCount = Math.min(leaderCount, nameCount);
  const leaderSlot = ((leaderNumber - 1) % leaderCount) % slotCount;
  const namesForSlot = Math.ceil((nameCount - leaderSlot) / slotCount);
  const employeeSlot = (employeeNumber - 1) % namesForSlot;
  return DEPARTMENT_EMPLOYEE_NAMES[leaderSlot + employeeSlot * slotCount];
}
