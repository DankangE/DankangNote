import { z } from 'zod';
import { ko } from 'zod/locales';

// z.config는 프로세스 전역이라 feature 모듈의 부수효과로 두면 메시지 언어가
// 모듈 로드 순서에 의존한다. 항상 이 모듈을 통해 z를 import하면
// 스키마 정의 전에 한국어 로케일이 적용됨이 보장된다.
z.config(ko());

export { z };
