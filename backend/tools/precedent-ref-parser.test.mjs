import assert from "node:assert/strict";
import test from "node:test";
import { compactName, parseReferences } from "./precedent-ref-parser.mjs";

test("가운뎃점 변형과 공백은 같은 이름으로 본다", () => {
  assert.equal(compactName("학원의 설립·운영 및 과외교습에 관한 법률"), compactName("학원의 설립ㆍ운영 및 과외교습에 관한 법률"));
});

const keys = (text) => parseReferences(text).map((r) => `${r.old ? "구 " : ""}${r.lawName} ${r.articleKey}`);

test("같은 법령의 여러 조문과 br 태그", () => {
  assert.deepEqual(keys("귀속재산처리법 제15조, 제29조<br/>"), ["귀속재산처리법 15", "귀속재산처리법 29"]);
});

test("항과 호는 버리고 조 단위로 모은다", () => {
  assert.deepEqual(keys("국가보안법 제7조 제1항, 제3항"), ["국가보안법 7"]);
  assert.deepEqual(
    keys("독점규제 및 공정거래에 관한 법률 제19조 제1항 제9호, 제23조 제3호"),
    ["독점규제 및 공정거래에 관한 법률 19", "독점규제 및 공정거래에 관한 법률 23"],
  );
});

test("[1] / [2] 구분과 중복 제거", () => {
  assert.deepEqual(keys("[1] 민법 제840조 제6호 / [2] 민법 제840조 제6호"), ["민법 840"]);
  assert.deepEqual(
    keys("[1] 국가배상법 제2조, 민법 제469조, 제744조 / [2] 국가배상법 제2조, 민법 제744조"),
    ["국가배상법 2", "민법 469", "민법 744"],
  );
});

test("쉼표 뒤 공백이 없어도 법령이 바뀐 것을 안다", () => {
  assert.deepEqual(
    keys("민법 제105조,건설산업기본법 제54조,제56조 제1항 제1호,건설산업기본법 시행령 제56조 제2항 제5호"),
    ["민법 105", "건설산업기본법 54", "건설산업기본법 56", "건설산업기본법 시행령 56"],
  );
});

test("구 법령과 개정 전 괄호, 가지번호", () => {
  assert.deepEqual(
    keys("구 국세기본법(2007. 12. 31. 법률 제8830호로 개정되기 전의 것) 제26조의2 제1항 제1호"),
    ["구 국세기본법 26의2"],
  );
  assert.deepEqual(
    keys("정보통신망 이용촉진 및 정보보호 등에 관한 법률 제22조, 구 정보통신망 이용촉진 및 정보보호 등에 관한 법률(2011. 3. 29. 법률 제10465호로 개정되기 전의 것) 제67조 제1항"),
    ["정보통신망 이용촉진 및 정보보호 등에 관한 법률 22", "구 정보통신망 이용촉진 및 정보보호 등에 관한 법률 67"],
  );
});

test("빈 값과 이상한 값", () => {
  assert.deepEqual(parseReferences(""), []);
  assert.deepEqual(parseReferences(null), []);
  assert.deepEqual(parseReferences("제3항"), []);
});
