import { RESCALE_ASPECT_RATIO, RESCALE_TARGET_SPACING } from "../../utils/constants"


// Used to rescale prescribed positions optionally provided in the instance array file
export async function runRescaleLayout(nodes, aspectRatio = RESCALE_ASPECT_RATIO, targetSpacing = RESCALE_TARGET_SPACING) {
    try {
        // Get range of x and y values
        let xMin = Infinity, xMax = -Infinity
        let yMin = Infinity, yMax = -Infinity

        nodes.forEach(node => {
            xMin = Math.min(xMin, node.position.x)
            xMax = Math.max(xMax, node.position.x)
            yMin = Math.min(yMin, node.position.y)
            yMax = Math.max(yMax, node.position.y)
        })

        // Scale x and y independently due to typical wide aspect ratio
        const xCentre = (xMax + xMin) / 2
        const yCentre = (yMax - yMin) / 2

        const xRange = xMax - xMin || 1
        const yRange = yMax - yMin || 1

        const xScale = (targetSpacing * aspectRatio) / xRange
        const yScale = targetSpacing / yRange

        nodes.forEach(node => {
            const refX = node.position.x
            const refY = node.position.y

            node.position = {
                x: (refX - xCentre) * xScale,
                y: (refY - yCentre) * yScale
            }

            node.data = {
                ...node.data,
                layoutFrame: {
                    xCentre,
                    yCentre,
                    xScale,
                    yScale,
                    aspectRatio,
                    targetSpacing,
                },
                layoutRef: {
                    refX,
                    refY,
                }
            }
        })
        return true
    } catch (err) {
        console.error('Rescale Layout Failed:', err)
        return false
    }
}

export function invertRescaleLayout(nodes) {
    nodes.forEach(node => {
        const frame = node.data?.layoutFrame
        const ref = node.data?.layoutRef
        if (!frame || !ref) return

        node.position = {
            x: ref.refX,
            y: ref.refY
        }
    })
}
