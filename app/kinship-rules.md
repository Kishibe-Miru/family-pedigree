# 中文亲属自动标记规则

本项目以“先证者/患者”为中心，自动给谱系图成员生成临床记录中常用的显示名称。规则参考中文亲属称谓的一般原则：区分父系/母系、长幼、性别、直系/旁系、血亲/姻亲。

## 主要来源

- ChineseLearner: Chinese distinguishes paternal/maternal relatives and older/younger siblings.
  https://chineselearner.com/topics/family/
- One to One Chinese: father’s older brother is 伯伯, younger brother is 叔叔; mother’s brother is 舅舅, mother’s sister is 姨妈.
  https://www.onetoonechinese.com/how-to-address-family-members-in-chinese/
- 亲戚计算器常用称谓表：整理兄弟姐妹、伯父、姨母、姻亲等常用称谓。
  https://ydys.axiaoxin.com/kinship/relation-names.html
- FluentU Family in Chinese: 汇总伯伯、姨妈、堂兄弟、表兄弟等基础称谓。
  https://www.fluentu.com/blog/chinese/family-in-chinese-2/
- Kinship terminology overview: many languages, including Chinese, distinguish relative age in sibling terms.
  https://en.wikipedia.org/wiki/Kinship_terminology

## 当前实现范围

为了适合精神科病历和疾病家族谱系图，本工具优先实现三代内高频称谓：

- 先证者本人：先证者
- 父母：父亲、母亲
- 祖辈：祖父、祖母、外祖父、外祖母
- 配偶：丈夫、妻子、配偶
- 子女：儿子、女儿
- 同胞：哥哥、姐姐、弟弟、妹妹；同一性别多个年长同胞可显示为大哥、二哥、大姐、二姐等
- 父系旁系：伯父、叔叔、姑姑
- 母系旁系：舅舅、姨妈
- 旁系子女：堂兄/堂弟/堂姐/堂妹、表兄/表弟/表姐/表妹

## 长幼判断

谱系图中同一父母下的子女默认按横向位置表示出生顺序：

- 左侧为年长
- 右侧为年幼

拖拽改变同胞左右位置后，系统会重新刷新称谓。

## 局限

- 地域称谓差异不自动处理，例如姥爷/外公、姥姥/外婆等统一采用“外祖父/外祖母”。
- 对再婚、收养、复杂姻亲、继亲、半同胞等，当前只做基础结构识别，复杂称谓建议手动编辑显示名称。
- 不确定关系保留原显示名称或使用通用称谓。
