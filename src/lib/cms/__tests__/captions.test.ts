import { describe, expect, it } from "vitest";
import { altCaption, figureCaptions, restoreBodyCaptions, splitCredit } from "../captions";

describe("legacy captions", () => {
  it("splits credits from captions", () => {
    expect(splitCredit("With few distilleries throughout Ireland, brands make their mark through blends. (Photo by Jeff Harris)")).toEqual({ caption: "With few distilleries throughout Ireland, brands make their mark through blends.", credit: "Jeff Harris" });
    expect(splitCredit("PHOTO BY MICHAEL GROSS")).toEqual({ caption: "", credit: "MICHAEL GROSS" });
    expect(splitCredit("A tasting for selecting a barrel at Four Roses. FOUR ROSES")).toEqual({ caption: "A tasting for selecting a barrel at Four Roses.", credit: "FOUR ROSES" });
    expect(splitCredit("Down One Bourbon Bar at Galt House KRIECH-HIGDON PHOTOGRAPHY")).toEqual({ caption: "Down One Bourbon Bar at Galt House", credit: "KRIECH-HIGDON PHOTOGRAPHY" });
    expect(splitCredit("The tahona crushes the cooked piñas. GETTY IMAGE / ISTOCKPHOTO")).toEqual({ caption: "The tahona crushes the cooked piñas.", credit: "GETTY IMAGE / ISTOCKPHOTO" });
    expect(splitCredit("Heaven Hill has more than 55 warehouses. COURTESY OF FOUR ROSES")).toEqual({ caption: "Heaven Hill has more than 55 warehouses.", credit: "COURTESY OF FOUR ROSES" });
    expect(splitCredit("Photo by Fabio Lovino/HBO")).toEqual({ caption: "", credit: "Fabio Lovino/HBO" });
    expect(splitCredit("ILLUSTRATION: JOHN S. DYKES")).toEqual({ caption: "", credit: "ILLUSTRATION: JOHN S. DYKES" });
    expect(splitCredit("Uncle Nearest founder Fawn Weaver")).toEqual({ caption: "Uncle Nearest founder Fawn Weaver", credit: "" });
    expect(splitCredit("Tasting at the WSWA")).toEqual({ caption: "Tasting at the WSWA", credit: "" });
  });

  it("keeps alt text that reads as a caption", () => {
    expect(altCaption("Ballykeefe founders Morgan and Anne Ging")).toBe("Ballykeefe founders Morgan and Anne Ging");
    expect(altCaption("roulette straight rye")).toBe("");
    expect(altCaption("larceny-barrel-proof.jpg")).toBe("");
    expect(altCaption("1")).toBe("");
    expect(altCaption("RYAN BREWER")).toBe("RYAN BREWER");
  });

  it("turns WordPress attachments and captioned images into figures", () => {
    const wp = `<p>Intro.</p><div id="attachment_19178" class="alignleft" width="680"><br/> <img src="/api/media/x/1?w=1600" alt="" /> Sakurao Distillery is new on the scene.</div><p>Next.</p>`;
    const a = restoreBodyCaptions(wp);
    expect(a.html).toBe(`<p>Intro.</p><figure><img src="/api/media/x/1?w=1600" alt="" /><figcaption>Sakurao Distillery is new on the scene.</figcaption></figure><p>Next.</p>`);
    expect(a.images).toEqual([{ src: "/api/media/x/1?w=1600", caption: "Sakurao Distillery is new on the scene.", credit: "" }]);

    const morweb = `<p><img src="/get/files/a.jpg" alt="A tasting for selecting a barrel at Four Roses. FOUR ROSES" width="817" /></p><p><img src="/b.jpg" alt="aberlour abunadh" /></p>`;
    const b = restoreBodyCaptions(morweb);
    expect(b.html).toBe(`<figure><img src="/get/files/a.jpg" alt="A tasting for selecting a barrel at Four Roses. FOUR ROSES" width="817" /><figcaption>A tasting for selecting a barrel at Four Roses. <span>FOUR ROSES</span></figcaption></figure><p><img src="/b.jpg" alt="aberlour abunadh" /></p>`);
    expect(restoreBodyCaptions(b.html).html).toBe(b.html);
    expect(figureCaptions(b.html)).toEqual([{ src: "/get/files/a.jpg", caption: "A tasting for selecting a barrel at Four Roses.", credit: "FOUR ROSES" }]);
  });
});
