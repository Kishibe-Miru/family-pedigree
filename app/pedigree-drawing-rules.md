# Pedigree Chart 绘制规则检查表

本文件保存本项目后续修改时必须遵循的谱系图连线规则，重点用于检查父代与子代连线是否居中、对称、连续。

## 参考来源

- University of Iowa, *How to Draw a Pedigree*：配偶/婚姻关系用连接两个符号的水平线；子代线从配偶线中心下降，连接到子女符号中心或同胞线。
  https://humangenetics.medicine.uiowa.edu/resources/how-draw-pedigree
- Bennett et al., *Standardized Human Pedigree Nomenclature: Update and Assessment of the Recommendations of the National Society of Genetic Counselors*：定义 relationship line、line of descent、sibship line、individual's line；建议男性配偶在左、女性配偶在右。
  https://www.geneticcounselingtoolkit.com/cases/pedigree/Bennett%20JGC%202008%20-%20Standardized%20Human%20Pedigree%20Nomenclature%20-%20Update%20and%20Assessment%20of%20the%20Recommendations%20of%20the%20National%20Society%20of%20Genetic%20Counselors.pdf
- MHCC Biology 112, *Pedigrees and Punnett Squares*：父母用水平线连接；同胞通常按出生顺序排列，年长者在左。
  https://openoregon.pressbooks.pub/mhccbiology112/chapter/pedigrees-and-punnett-squares/
- Pedscases, *Approach to the Family History and Pedigree*：sibship line 为水平线，每个孩子的 individual line 从该线向下连接。
  https://www.pedscases.com/sites/default/files/Approach%20to%20Family%20History%20and%20Pedigrees%20Script_July%2031%202022.docx.pdf

## 必须遵循的连线规则

1. 配偶线必须是同代水平线，连接两个配偶符号的中心高度。
2. 父母到子女的主下降线必须从配偶线的几何中点垂直向下。
3. 多个子女必须共享一条水平同胞线，称为 sibship line。
4. 每个子女必须通过自己的短竖线从 sibship line 连接到符号上边缘。
5. 单个子女时，可从配偶线中点直接垂直连到子女符号上边缘；如果子女未在中点正下方，则必须先自动居中，而不是画折线。
6. 同胞按出生顺序从左到右排列；若没有年龄字段，使用画布横向位置作为顺序。
7. 男性配偶默认在左，女性配偶默认在右；但不能因此破坏同胞主轴。
8. 连线端点必须接触符号边缘，不应悬空或穿过符号内部。
9. 同胞线不得穿过任何节点；配偶线不得穿过非配偶节点。

## 修改代码后的检查项

- [ ] 父母配偶线的中点是否与下降线 x 坐标一致。
- [ ] 子女组中心是否位于父母配偶线中点正下方。
- [ ] 单子女是否自动居中到父母线中点下方。
- [ ] 多子女是否共享同一条 sibship line。
- [ ] 每个子女的竖线是否垂直接到符号上边缘。
- [ ] 年长同胞是否在左，年幼同胞是否在右。
- [ ] 配偶排序是否未破坏同胞排序。
- [ ] 关系线是否没有穿过无关节点。
