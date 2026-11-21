import CharacterLab from "@/components/office3d/person/CharacterLab";

export const metadata = { title: "캐릭터 확인" };

/** 3D 캐릭터 확인용 페이지. 겉모습·자세·타자 손 위치·걷기를 본다. */
export default function CharactersPage() {
  return <CharacterLab />;
}
