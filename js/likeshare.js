import { app } from "../../../scripts/app.js";

app.registerExtension({
    name: "Likeshare.Note",
    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (
            nodeData.name === "LikeShareEncrypt" ||
            nodeData.name === "LikeShareDecrypt"
        ) {
            const NOTE_HEIGHT = 22;

            const origComputeSize = nodeType.prototype.computeSize;
            nodeType.prototype.computeSize = function () {
                const sz = origComputeSize
                    ? origComputeSize.apply(this, arguments)
                    : [this.size[0], this.size[1]];
                return [sz[0], sz[1] + NOTE_HEIGHT];
            };

            const origDrawForeground = nodeType.prototype.onDrawForeground;
            nodeType.prototype.onDrawForeground = function (ctx) {
                if (origDrawForeground) {
                    origDrawForeground.apply(this, arguments);
                }

                const text =
                    "Deterministic reversible Hilbert-curve pixel shuffle.";

                ctx.save();
                ctx.fillStyle = "#aaa";
                ctx.font = "10px Arial";
                ctx.textAlign = "left";
                ctx.textBaseline = "bottom";

                const x = this.pos[0] + 8;
                const y = this.pos[1] + this.size[1] - 5;
                ctx.fillText(text, x, y);

                ctx.restore();
            };
        }
    },
});
